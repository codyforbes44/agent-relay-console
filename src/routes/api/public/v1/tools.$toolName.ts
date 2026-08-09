import { createFileRoute } from "@tanstack/react-router";

import { TOOLS_BY_NAME } from "@/lib/agent/contracts";
import { runTool } from "@/lib/agent/tools.server";
import { apiError, json, preflight, toolDescriptor } from "@/lib/api/catalog.server";
import { authenticateAgentKey, readBearer } from "@/lib/api/keys.server";
import { checkRateLimit, getBalance, recordUsage, touchKey } from "@/lib/api/metering.server";

function log(event: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...fields }));
}

export const Route = createFileRoute("/api/public/v1/tools/$toolName")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),

      GET: async ({ params, request }) => {
        const tool = TOOLS_BY_NAME[params.toolName];
        if (!tool?.publicApi) return apiError(404, "unknown_tool", `No such tool: ${params.toolName}`);
        return json({ ok: true, tool: toolDescriptor(tool, new URL(request.url).origin) });
      },

      POST: async ({ params, request }) => {
        const requestId = crypto.randomUUID();
        const started = Date.now();
        const toolName = params.toolName;

        const tool = TOOLS_BY_NAME[toolName];
        if (!tool?.publicApi) return apiError(404, "unknown_tool", `No such tool: ${toolName}`);

        const raw = readBearer(request);
        if (!raw) return apiError(401, "missing_api_key", "Provide Authorization: Bearer sk_agent_...");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const identity = await authenticateAgentKey(supabaseAdmin, raw);
        if (!identity) return apiError(401, "invalid_api_key", "API key is invalid or revoked");
        if (!identity.scopes.includes("tools:invoke")) {
          return apiError(403, "insufficient_scope", "This key cannot invoke tools");
        }

        if (!(await checkRateLimit(supabaseAdmin, identity.keyId))) {
          return apiError(429, "rate_limited", "Too many calls for this key, retry in a minute");
        }

        // Side-effecting tools need an explicit, per-call authorization signal.
        if (tool.sideEffecting && request.headers.get("x-confirm-side-effects") !== "true") {
          await recordUsage(supabaseAdmin, {
            orgId: identity.orgId,
            keyId: identity.keyId,
            toolName,
            credits: 0,
            status: "rejected",
            errorCode: "confirmation_required",
            latencyMs: Date.now() - started,
            requestId,
          });
          return apiError(
            428,
            "confirmation_required",
            "This tool has side effects. Retry with header 'x-confirm-side-effects: true' to authorize it.",
            { tool: toolName, credits: tool.credits },
          );
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return apiError(422, "invalid_json", "Request body must be JSON");
        }

        const parsed = tool.schema.safeParse(body);
        if (!parsed.success) {
          return apiError(422, "invalid_input", "Input does not match the tool schema", {
            issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          });
        }

        const balance = await getBalance(supabaseAdmin, identity.orgId);
        if (balance < tool.credits) {
          return apiError(402, "insufficient_credits", "Not enough credits for this call", {
            required: tool.credits,
            balance,
          });
        }

        let result: Record<string, unknown>;
        try {
          result = await runTool(toolName, parsed.data);
        } catch (e) {
          const message = e instanceof Error ? e.message : "Tool execution failed";
          await recordUsage(supabaseAdmin, {
            orgId: identity.orgId,
            keyId: identity.keyId,
            toolName,
            credits: 0,
            status: "error",
            errorCode: "tool_failed",
            latencyMs: Date.now() - started,
            requestId,
          });
          log("public_tool_error", { requestId, toolName, orgId: identity.orgId, message });
          return apiError(502, "tool_failed", message);
        }

        const latencyMs = Date.now() - started;
        await Promise.all([
          recordUsage(supabaseAdmin, {
            orgId: identity.orgId,
            keyId: identity.keyId,
            toolName,
            credits: tool.credits,
            status: "success",
            latencyMs,
            requestId,
          }),
          touchKey(supabaseAdmin, identity.keyId),
        ]);

        log("public_tool_call", {
          requestId,
          toolName,
          orgId: identity.orgId,
          keyId: identity.keyId,
          credits: tool.credits,
          latencyMs,
        });

        return json(
          {
            ok: true,
            requestId,
            tool: toolName,
            demo: tool.demo,
            credits: { charged: tool.credits, balance: balance - tool.credits },
            result,
          },
          200,
          { "x-request-id": requestId, "x-credits-charged": String(tool.credits) },
        );
      },
    },
  },
});

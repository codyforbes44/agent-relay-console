import { defineMcp, defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

import { TOOLS_BY_NAME, type ToolContract } from "@/lib/agent/contracts";
import { runTool } from "@/lib/agent/tools.server";
import {
  issueConfirmation,
  redeemConfirmation,
  releaseConfirmation,
  storeConfirmationResponse,
} from "@/lib/api/confirmations.server";
import { isToolEnabled } from "@/lib/api/org-tools.server";
import { getOrgSettings, requiresConfirmation } from "@/lib/api/settings.server";
import { supabaseForUser } from "./supabase";

type Result = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function fail(text: string): Result {
  return { content: [{ type: "text", text }], isError: true };
}

/** Resolves the caller's workspace via RLS-scoped membership. */
async function resolveOrgId(ctx: ToolContext): Promise<string | null> {
  const supabase = supabaseForUser(ctx);
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return null;
  // Super admins can read every membership row, so always scope to self.
  const { data } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as { org_id?: string } | null)?.org_id ?? null;
}

/**
 * Runs a catalog tool for an authenticated MCP caller, metering credits
 * against their workspace exactly like the public REST API does.
 */
async function runMetered(
  contract: ToolContract,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<Result> {
  if (!ctx.isAuthenticated()) return fail("Not authenticated");

  const orgId = await resolveOrgId(ctx);
  if (!orgId) return fail("No workspace found for this account");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  if (!(await isToolEnabled(supabaseAdmin, orgId, contract.name))) {
    return fail(`Tool ${contract.name} is disabled for this workspace`);
  }

  // Confirmation parity with REST: the token is bound to these exact
  // arguments, single-use, and can only come from a preview we issued.
  const { confirmation_token: rawToken, ...toolArgs } = args as Record<string, unknown>;
  const settings = await getOrgSettings(supabaseAdmin, orgId);
  const gated = requiresConfirmation(settings.confirmationDefault, contract.sideEffecting);
  let confirmationId: string | null = null;

  if (gated) {
    const token = typeof rawToken === "string" && rawToken.trim() ? rawToken.trim() : null;
    if (!token) {
      const issued = await issueConfirmation(supabaseAdmin, {
        orgId,
        keyId: null,
        tool: contract,
        args: toolArgs,
      });
      const payload = {
        ok: false,
        error: {
          code: "confirmation_required",
          message:
            "This tool has side effects. Show this preview to the human, then call again with confirmation_token set to the value below.",
          tool: contract.name,
          credits: contract.credits,
          preview: issued.preview,
          confirmationToken: issued.token,
          expiresAt: issued.expiresAt,
        },
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
        isError: true,
      };
    }

    const redeemed = await redeemConfirmation(supabaseAdmin, {
      token,
      orgId,
      toolName: contract.name,
      args: toolArgs,
    });
    if (!redeemed.ok) return fail(`${redeemed.failure.code}: ${redeemed.failure.message}`);
    if (redeemed.replay) {
      return {
        content: [{ type: "text", text: JSON.stringify(redeemed.replay, null, 2) }],
        structuredContent: redeemed.replay,
      };
    }
    confirmationId = redeemed.id;
  }

  const started = Date.now();
  const { reserveCredits, refundReservedCredits, finalizeUsage } =
    await import("@/lib/api/metering.server");

  // Same atomic reserve-then-run path as the HTTP API: balance is checked and
  // debited in one transaction so concurrent sessions cannot double-spend.
  const reservation = await reserveCredits(supabaseAdmin, {
    orgId,
    keyId: null,
    toolName: contract.name,
    credits: contract.credits,
    requestId: crypto.randomUUID(),
  });

  if (reservation.status === "insufficient") {
    if (confirmationId) await releaseConfirmation(supabaseAdmin, confirmationId);
    return fail(
      `Insufficient credits: this call costs ${contract.credits}, balance is ${reservation.balance}. Top up in the Relay console.`,
    );
  }
  if (reservation.status !== "ok") {
    if (confirmationId) await releaseConfirmation(supabaseAdmin, confirmationId);
    return fail("Credit metering is temporarily unavailable, retry shortly.");
  }

  let result: Record<string, unknown>;
  try {
    result = await runTool(contract.name, toolArgs);
  } catch (e) {
    await refundReservedCredits(supabaseAdmin, reservation.usageEventId, "tool_failed");
    if (confirmationId) await releaseConfirmation(supabaseAdmin, confirmationId);
    return fail(e instanceof Error ? e.message : "Tool execution failed");
  }

  // In-band failures ({ ok: false }) are refunded too — a failed call is free.
  if (result["ok"] === false) {
    await refundReservedCredits(supabaseAdmin, reservation.usageEventId, "tool_failed");
    if (confirmationId) await releaseConfirmation(supabaseAdmin, confirmationId);
    return fail(String(result["error"] ?? "Tool execution failed"));
  }

  await finalizeUsage(supabaseAdmin, reservation.usageEventId, Date.now() - started);

  await supabaseAdmin.from("audit_logs").insert({
    org_id: orgId,
    user_id: ctx.getUserId() ?? null,
    action: "mcp_tool_invoked",
    tool_name: contract.name,
    payload: {
      client_id: ctx.getClientId() ?? null,
      credits: contract.credits,
      side_effecting: contract.sideEffecting,
      demo: contract.demo,
    },
  });

  const payload = {
    ...result,
    demo: contract.demo,
    credits: { charged: contract.credits, balance: reservation.balance },
  };
  if (confirmationId) await storeConfirmationResponse(supabaseAdmin, confirmationId, payload);

  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

type McpTool = Parameters<typeof defineMcp>[0]["tools"][number];

/** Builds an MCP tool from the shared typed contract registry. */
export function mcpToolFor(name: string): McpTool {
  const contract = TOOLS_BY_NAME[name];
  if (!contract) throw new Error(`Unknown tool contract: ${name}`);

  const shape = (contract.schema as unknown as z.ZodObject<z.ZodRawShape>).shape;

  return defineTool({
    name: contract.name,
    title: contract.label,
    description: [
      contract.description,
      `Costs ${contract.credits} credit(s) per call.`,
      `Example arguments: ${JSON.stringify(contract.example)}.`,
      `Example result: ${JSON.stringify(contract.exampleResult)}.`,
      contract.sideEffecting
        ? "Side-effecting, two-step: call it first WITHOUT confirmation_token — it returns a preview plus a single-use confirmationToken. Show that preview to the human, and only after they approve, call again with the identical arguments plus confirmation_token. The token is bound to those exact arguments and expires in 10 minutes."
        : "Read-only and safe to retry.",
    ].join(" "),
    inputSchema: contract.sideEffecting
      ? {
          ...shape,
          confirmation_token: z
            .string()
            .optional()
            .describe(
              "Single-use token from this tool's previous confirmation_required response. Omit on the first call to get the preview.",
            ),
        }
      : shape,

    annotations: {
      readOnlyHint: !contract.sideEffecting,
      idempotentHint: !contract.sideEffecting,
      destructiveHint: contract.sideEffecting,
      openWorldHint: true,
    },
    handler: (args: Record<string, unknown>, ctx: ToolContext) => runMetered(contract, args, ctx),
  }) as unknown as McpTool;
}

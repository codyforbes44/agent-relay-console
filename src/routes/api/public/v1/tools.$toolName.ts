import { createFileRoute } from "@tanstack/react-router";

import { TOOLS_BY_NAME } from "@/lib/agent/contracts";
import { runTool } from "@/lib/agent/tools.server";
import { apiError, json, preflight, toolDescriptor } from "@/lib/api/catalog.server";
import { authenticateAgentKey, readBearer } from "@/lib/api/keys.server";
import { checkKeyGuardrails, checkRateLimit, getBalance, recordUsage, touchKey } from "@/lib/api/metering.server";
import {
  buildOffer,
  creditSettledPayment,
  markIntentFailed,
  offerBody,
  recordIntent,
} from "@/lib/api/payments.server";
import { readPaymentHeader, verifyAndSettle } from "@/lib/api/x402.server";
import { MACHINE_TOPUP_MIN_CREDITS } from "@/lib/billing/packs";

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
            {
              tool: toolName,
              credits: tool.credits,
              preview: {
                summary: tool.summarize(parsed.data),
                args: parsed.data,
              },
            },
          );
        }

        // Idempotency: first writer wins, replays return the stored response uncharged.
        const idemKey = request.headers.get("idempotency-key");
        let idemClaimed = false;
        if (idemKey) {
          const { error: idemError } = await supabaseAdmin.from("api_idempotency").insert({
            key_id: identity.keyId,
            idem_key: idemKey,
            org_id: identity.orgId,
            tool_name: toolName,
          });
          if (idemError) {
            const { data: existing } = await supabaseAdmin
              .from("api_idempotency")
              .select("response")
              .eq("key_id", identity.keyId)
              .eq("idem_key", idemKey)
              .maybeSingle();
            if (existing?.response) {
              return json({ ...(existing.response as Record<string, unknown>), replayed: true }, 200, {
                "idempotency-replayed": "true",
              });
            }
            return apiError(409, "request_in_progress", "A call with this idempotency-key is still running");
          }
          idemClaimed = true;
        }

        const releaseIdem = async () => {
          if (!idemClaimed || !idemKey) return;
          await supabaseAdmin
            .from("api_idempotency")
            .delete()
            .eq("key_id", identity.keyId)
            .eq("idem_key", idemKey);
        };

        let balance = await getBalance(supabaseAdmin, identity.orgId);
        let paymentReceipt: Record<string, unknown> | null = null;

        if (balance < tool.credits) {
          // Buy at least the shortfall, in whole top-up units, so a paying
          // agent does not have to re-pay on its very next call.
          const shortfall = tool.credits - balance;
          const topUp = Math.max(MACHINE_TOPUP_MIN_CREDITS, shortfall);
          const offer = buildOffer({
            resource: new URL(request.url).toString(),
            description: `RELAY credits (${topUp}) to call ${toolName}`,
            credits: topUp,
          });

          const paymentPayload = offer ? readPaymentHeader(request) : null;

          if (offer && paymentPayload) {
            try {
              const settlement = await verifyAndSettle(offer.config, paymentPayload, offer.requirements);
              await creditSettledPayment(supabaseAdmin, {
                orgId: identity.orgId,
                keyId: identity.keyId,
                offer,
                payer: settlement.payer,
                txHash: settlement.txHash,
                purpose: "tool_call",
                toolName,
                requestId,
              });
              balance = await getBalance(supabaseAdmin, identity.orgId);
              paymentReceipt = {
                credits: offer.credits,
                amountUsd: offer.usd,
                asset: offer.config.assetName,
                network: settlement.network,
                payer: settlement.payer,
                transaction: settlement.txHash,
              };
              log("x402_settled", { requestId, orgId: identity.orgId, credits: offer.credits, tx: settlement.txHash });
            } catch (e) {
              const message = e instanceof Error ? e.message : "Payment could not be settled";
              await markIntentFailed(supabaseAdmin, offer.nonce, message);
              await releaseIdem();
              log("x402_failed", { requestId, orgId: identity.orgId, message });
              return apiError(402, "payment_failed", message, { required: tool.credits, balance });
            }
          }

          if (balance < tool.credits) {
            await releaseIdem();
            if (!offer) {
              return apiError(402, "insufficient_credits", "Not enough credits for this call", {
                required: tool.credits,
                balance,
              });
            }
            await recordIntent(supabaseAdmin, {
              orgId: identity.orgId,
              keyId: identity.keyId,
              offer,
              purpose: "tool_call",
              toolName,
              requestId,
            });
            return json(
              offerBody(offer, "insufficient_credits", { required: tool.credits, balance, tool: toolName }),
              402,
              { "x-request-id": requestId, "x-credits-required": String(tool.credits) },
            );
          }
        }



        let result: Record<string, unknown>;
        try {
          result = await runTool(toolName, parsed.data);
        } catch (e) {
          const message = e instanceof Error ? e.message : "Tool execution failed";
          await releaseIdem();
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

        const payload = {
          ok: true,
          requestId,
          tool: toolName,
          demo: tool.demo,
          credits: { charged: tool.credits, balance: balance - tool.credits },
          result,
        };

        if (idemClaimed && idemKey) {
          await supabaseAdmin
            .from("api_idempotency")
            .update({ response: payload as unknown as Record<string, never> })
            .eq("key_id", identity.keyId)
            .eq("idem_key", idemKey);
        }

        return json(payload, 200, {
          "x-request-id": requestId,
          "x-credits-charged": String(tool.credits),
        });

      },
    },
  },
});

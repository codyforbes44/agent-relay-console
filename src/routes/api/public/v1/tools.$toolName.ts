import { createFileRoute } from "@tanstack/react-router";

import { resolveTool } from "@/lib/agent/contracts";
import { runTool } from "@/lib/agent/tools.server";
import { apiError, json, preflight, toolDescriptor } from "@/lib/api/catalog.server";
import {
  CONFIRMATION_HEADER,
  issueConfirmation,
  redeemConfirmation,
  releaseConfirmation,
  storeConfirmationResponse,
} from "@/lib/api/confirmations.server";
import { getOrgSettings, requiresConfirmation } from "@/lib/api/settings.server";
import { isToolEnabled } from "@/lib/api/org-tools.server";
import { authenticateAgentKey, readBearer } from "@/lib/api/keys.server";
import {
  budgetViolation,
  checkKeyGuardrails,
  checkRateLimit,
  finalizeUsage,
  recordUsage,
  refundReservedCredits,
  reserveCredits,
  touchKey,
} from "@/lib/api/metering.server";
import {
  buildOffer,
  creditSettledPayment,
  markIntentFailed,
  offerBody,
  recordIntent,
} from "@/lib/api/payments.server";
import { readPaymentHeader, verifyAndSettle } from "@/lib/api/x402.server";
import { MACHINE_TOPUP_MIN_CREDITS, usdForCredits } from "@/lib/billing/packs";

function log(event: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...fields }));
}

export const Route = createFileRoute("/api/public/v1/tools/$toolName")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),

      GET: async ({ params, request }) => {
        const { tool } = resolveTool(params.toolName);
        if (!tool?.publicApi) return apiError(404, "unknown_tool", `No such tool: ${params.toolName}`);
        return json({ ok: true, tool: toolDescriptor(tool, new URL(request.url).origin) });
      },

      POST: async ({ params, request }) => {
        const requestId = crypto.randomUUID();
        const started = Date.now();
        const origin = new URL(request.url).origin;
        // Deprecated pre-sandbox names still resolve, but everything downstream
        // (metering, confirmations, audit) uses the canonical name.
        const requestedName = params.toolName;
        const { tool, canonicalName: toolName, deprecatedAlias } = resolveTool(requestedName);
        if (!tool?.publicApi) return apiError(404, "unknown_tool", `No such tool: ${requestedName}`);

        const raw = readBearer(request);
        if (!raw) return apiError(401, "missing_api_key", "Provide Authorization: Bearer sk_agent_...");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const identity = await authenticateAgentKey(supabaseAdmin, raw);
        if (!identity) return apiError(401, "invalid_api_key", "API key is invalid or revoked");
        if (!identity.scopes.includes("tools:invoke")) {
          return apiError(403, "insufficient_scope", "This key cannot invoke tools");
        }

        const violation = await checkKeyGuardrails(supabaseAdmin, identity, toolName, tool.credits);
        if (violation) {
          await recordUsage(supabaseAdmin, {
            orgId: identity.orgId,
            keyId: identity.keyId,
            toolName,
            credits: 0,
            status: "rejected",
            errorCode: violation.code,
            latencyMs: Date.now() - started,
            requestId,
          });
          return apiError(violation.status, violation.code, violation.message, violation.extra ?? {});
        }

        // Workspace-level tool visibility: a disabled tool cannot be invoked.
        if (!(await isToolEnabled(supabaseAdmin, identity.orgId, toolName))) {
          await recordUsage(supabaseAdmin, {
            orgId: identity.orgId,
            keyId: identity.keyId,
            toolName,
            credits: 0,
            status: "rejected",
            errorCode: "tool_disabled",
            latencyMs: Date.now() - started,
            requestId,
          });
          return apiError(403, "tool_disabled", `Tool ${toolName} is disabled for this workspace`);
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

        // Confirmation policy is configured per workspace (settings page).
        // Authorization is a one-shot token bound to these exact arguments —
        // an agent cannot pre-confirm a call whose preview no human ever saw.
        const orgSettings = await getOrgSettings(supabaseAdmin, identity.orgId);
        const needsConfirmation = requiresConfirmation(
          orgSettings.confirmationDefault,
          tool.sideEffecting,
        );
        let confirmationId: string | null = null;

        if (needsConfirmation) {
          const token = request.headers.get(CONFIRMATION_HEADER);

          if (!token) {
            const issued = await issueConfirmation(supabaseAdmin, {
              orgId: identity.orgId,
              keyId: identity.keyId,
              tool,
              args: parsed.data,
            });
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
              `This tool has side effects. Show the preview to your operator, then retry the identical request with header '${CONFIRMATION_HEADER}: <confirmationToken>'.`,
              {
                tool: toolName,
                credits: tool.credits,
                preview: issued.preview,
                confirmationToken: issued.token,
                expiresAt: issued.expiresAt,
              },
            );
          }

          const redeemed = await redeemConfirmation(supabaseAdmin, {
            token,
            orgId: identity.orgId,
            toolName,
            args: parsed.data,
          });

          if (!redeemed.ok) {
            await recordUsage(supabaseAdmin, {
              orgId: identity.orgId,
              keyId: identity.keyId,
              toolName,
              credits: 0,
              status: "rejected",
              errorCode: redeemed.failure.code,
              latencyMs: Date.now() - started,
              requestId,
            });
            return apiError(
              redeemed.failure.status,
              redeemed.failure.code,
              redeemed.failure.message,
              redeemed.failure.extra ?? {},
            );
          }

          if (redeemed.replay) {
            return json({ ...redeemed.replay, replayed: true }, 200, {
              "x-request-id": requestId,
              "x-confirmation-replayed": "true",
            });
          }

          confirmationId = redeemed.id;
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
            // No time-based reclaim: nothing bounds tool execution, so deleting
            // a claim could re-run a live call. The agent must use a new key.
            return apiError(
              409,
              "request_in_progress",
              "A call with this idempotency-key is still running. Poll or wait for the original response; if the original request is known to have failed, retry with a new idempotency-key.",
            );
          }
          idemClaimed = true;
        }

        const releaseIdem = async () => {
          if (confirmationId) await releaseConfirmation(supabaseAdmin, confirmationId);
          if (!idemClaimed || !idemKey) return;
          await supabaseAdmin
            .from("api_idempotency")
            .delete()
            .eq("key_id", identity.keyId)
            .eq("idem_key", idemKey);
        };

        // Reserve first: balance + spend caps are checked and the debit written
        // in one transaction, so concurrent calls cannot double-spend.
        const reserveInput = {
          orgId: identity.orgId,
          keyId: identity.keyId,
          toolName,
          credits: tool.credits,
          requestId,
          maxPerCall: identity.limits.maxCreditsPerCall,
          dailyCap: identity.limits.dailyCreditCap,
          totalCap: identity.limits.totalCreditCap,
        };

        let reservation = await reserveCredits(supabaseAdmin, reserveInput);
        let paymentReceipt: Record<string, unknown> | null = null;

        if (reservation.status === "budget_exceeded") {
          const violation = budgetViolation(reservation);
          await releaseIdem();
          await recordUsage(supabaseAdmin, {
            orgId: identity.orgId,
            keyId: identity.keyId,
            toolName,
            credits: 0,
            status: "rejected",
            errorCode: violation.code,
            latencyMs: Date.now() - started,
            requestId,
          });
          return apiError(violation.status, violation.code, violation.message, violation.extra ?? {});
        }

        if (reservation.status === "error") {
          await releaseIdem();
          return apiError(503, "metering_unavailable", "Credit metering is temporarily unavailable, retry shortly");
        }

        if (reservation.status === "insufficient") {
          const balance = reservation.balance;
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
              // Retry the reservation once against the freshly credited balance.
              reservation = await reserveCredits(supabaseAdmin, reserveInput);
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

          if (reservation.status !== "ok") {
            const currentBalance = reservation.status === "insufficient" ? reservation.balance : balance;
            await releaseIdem();
            if (!offer) {
              // No x402 config: still answer with everything needed to top up.
              return apiError(402, "insufficient_credits", "Not enough credits for this call", {
                required: tool.credits,
                balance: currentBalance,
                usdRequired: usdForCredits(tool.credits),
                checkout: {
                  machine: { url: `${origin}/api/public/v1/credits/purchase`, method: "POST" },
                  human: { url: `${origin}/pricing` },
                  pricingUrl: `${origin}/api/public/v1/pricing`,
                },
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
              offerBody(offer, "insufficient_credits", {
                required: tool.credits,
                balance: currentBalance,
                tool: toolName,
              }),
              402,
              { "x-request-id": requestId, "x-credits-required": String(tool.credits) },
            );
          }
        }

        const reserved = reservation;

        let result: Record<string, unknown>;
        try {
          result = await runTool(toolName, parsed.data);
        } catch (e) {
          const message = e instanceof Error ? e.message : "Tool execution failed";
          await releaseIdem();
          await refundReservedCredits(supabaseAdmin, reserved.usageEventId, "tool_failed");
          log("public_tool_error", { requestId, toolName, orgId: identity.orgId, message });
          return apiError(502, "tool_failed", message);
        }

        const latencyMs = Date.now() - started;
        await Promise.all([
          finalizeUsage(supabaseAdmin, reserved.usageEventId, latencyMs),
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
          ...(deprecatedAlias
            ? { deprecated: { calledAs: deprecatedAlias, use: toolName } }
            : {}),
          credits: { charged: tool.credits, balance: reserved.balance },
          ...(paymentReceipt ? { payment: paymentReceipt } : {}),
          result,
        };

        if (confirmationId) await storeConfirmationResponse(supabaseAdmin, confirmationId, payload);

        if (idemClaimed && idemKey) {
          // Retention only: completed claims expire after 24h so the stored
          // responses do not grow unbounded. In-flight claims never expire.
          await supabaseAdmin
            .from("api_idempotency")
            .update({
              response: payload as unknown as Record<string, never>,
              expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            })
            .eq("key_id", identity.keyId)
            .eq("idem_key", idemKey);

          // Opportunistic purge of expired completed rows.
          void supabaseAdmin
            .from("api_idempotency")
            .delete()
            .lt("expires_at", new Date().toISOString())
            .then(() => undefined);
        }

        return json(payload, 200, {
          "x-request-id": requestId,
          "x-credits-charged": String(tool.credits),
        });

      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";

import { apiError, json, preflight } from "@/lib/api/catalog.server";
import { authenticateAgentKey, readBearer } from "@/lib/api/keys.server";
import { checkRateLimit, getBalance } from "@/lib/api/metering.server";
import {
  buildOffer,
  creditSettledPayment,
  markIntentFailed,
  offerBody,
  recordIntent,
} from "@/lib/api/payments.server";
import { readPaymentHeader, verifyAndSettle } from "@/lib/api/x402.server";
import {
  MACHINE_TOPUP_MAX_CREDITS,
  MACHINE_TOPUP_MIN_CREDITS,
  usdForCredits,
} from "@/lib/billing/packs";

/**
 * Machine-to-machine credit top-up over x402. An agent POSTs the number of
 * credits it wants, receives a 402 with a payable offer, settles it, and
 * retries with an X-PAYMENT header — no human and no browser in the loop.
 */
export const Route = createFileRoute("/api/public/v1/credits/purchase")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),

      POST: async ({ request }) => {
        const requestId = crypto.randomUUID();

        const raw = readBearer(request);
        if (!raw)
          return apiError(401, "missing_api_key", "Provide Authorization: Bearer sk_agent_...");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const identity = await authenticateAgentKey(supabaseAdmin, raw);
        if (!identity) return apiError(401, "invalid_api_key", "API key is invalid or revoked");

        if (!(await checkRateLimit(supabaseAdmin, identity.keyId))) {
          return apiError(429, "rate_limited", "Too many calls for this key, retry in a minute");
        }

        let body: { credits?: unknown } = {};
        try {
          body = (await request.json()) as { credits?: unknown };
        } catch {
          body = {};
        }

        const credits = Math.floor(Number(body.credits ?? MACHINE_TOPUP_MIN_CREDITS));
        if (
          !Number.isFinite(credits) ||
          credits < MACHINE_TOPUP_MIN_CREDITS ||
          credits > MACHINE_TOPUP_MAX_CREDITS
        ) {
          return apiError(
            422,
            "invalid_input",
            `credits must be an integer between ${MACHINE_TOPUP_MIN_CREDITS} and ${MACHINE_TOPUP_MAX_CREDITS}`,
          );
        }

        const offer = buildOffer({
          resource: new URL(request.url).toString(),
          description: `RELAY credit top-up (${credits} credits)`,
          credits,
        });
        if (!offer) {
          return apiError(
            402,
            "insufficient_credits",
            "Machine payments are not enabled on this deployment. Use POST /api/public/v1/claim to have a human buy credits.",
            { required: credits, amountUsd: usdForCredits(credits) },
          );
        }

        const paymentPayload = readPaymentHeader(request);
        if (!paymentPayload) {
          await recordIntent(supabaseAdmin, {
            orgId: identity.orgId,
            keyId: identity.keyId,
            offer,
            purpose: "topup",
            requestId,
          });
          return json(offerBody(offer, "payment_required"), 402, { "x-request-id": requestId });
        }

        try {
          const settlement = await verifyAndSettle(
            offer.config,
            paymentPayload,
            offer.requirements,
          );
          await creditSettledPayment(supabaseAdmin, {
            orgId: identity.orgId,
            keyId: identity.keyId,
            offer,
            payer: settlement.payer,
            txHash: settlement.txHash,
            purpose: "topup",
            requestId,
          });
          const balance = await getBalance(supabaseAdmin, identity.orgId);
          return json(
            {
              ok: true,
              requestId,
              credits: { added: offer.credits, balance },
              payment: {
                amountUsd: offer.usd,
                asset: offer.config.assetName,
                network: settlement.network,
                payer: settlement.payer,
                transaction: settlement.txHash,
              },
            },
            200,
            { "x-request-id": requestId },
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : "Payment could not be settled";
          await markIntentFailed(supabaseAdmin, offer.nonce, message);
          return apiError(402, "payment_failed", message, { required: credits });
        }
      },
    },
  },
});

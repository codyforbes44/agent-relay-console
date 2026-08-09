/**
 * Machine payment orchestration: turn an out-of-credits situation into a
 * payable 402 offer, and turn a settled payment into ledger credits.
 *
 * Credits are written with (source, external_ref) = ('x402', tx hash), which a
 * unique index enforces, so a replayed payment can never be credited twice.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { usdForCredits } from "@/lib/billing/packs";
import {
  X402_VERSION,
  paymentRequirements,
  x402Config,
  type PaymentRequirements,
  type X402Config,
} from "@/lib/api/x402.server";

export type PaymentOffer = {
  config: X402Config;
  requirements: PaymentRequirements;
  nonce: string;
  credits: number;
  usd: number;
};

/** Builds the offer that accompanies a 402. Returns null when x402 is unconfigured. */
export function buildOffer(input: {
  resource: string;
  description: string;
  credits: number;
}): PaymentOffer | null {
  const config = x402Config();
  if (!config) return null;

  const usd = usdForCredits(input.credits);
  return {
    config,
    nonce: crypto.randomUUID(),
    credits: input.credits,
    usd,
    requirements: paymentRequirements({
      config,
      resource: input.resource,
      description: input.description,
      usd,
    }),
  };
}

/** The `accepts` block an x402 client reads off a 402 response. */
export function offerBody(offer: PaymentOffer, error: string, extra: Record<string, unknown> = {}) {
  return {
    x402Version: X402_VERSION,
    error,
    accepts: [offer.requirements],
    payment: {
      nonce: offer.nonce,
      credits: offer.credits,
      amountUsd: offer.usd,
      asset: offer.config.assetName,
      network: offer.config.network,
      payTo: offer.config.payTo,
      instructions:
        "Retry this exact request with an X-PAYMENT header built from accepts[0]. Credits are added before the call runs.",
    },
    checkout: {
      machine: {
        protocol: "x402",
        retryWithHeader: "x-payment",
        topupUrl: "/api/public/v1/credits/purchase",
        topupMethod: "POST",
      },
      human: { url: "/pricing", note: "A human can buy a credit pack with a card instead." },
      pricingUrl: "/api/public/v1/pricing",
    },
    ...extra,
  };
}

export async function recordIntent(
  admin: SupabaseClient,
  input: {
    orgId: string;
    keyId: string | null;
    offer: PaymentOffer;
    purpose: "tool_call" | "topup";
    toolName?: string | null;
    requestId: string;
  },
) {
  await admin.from("payment_intents").insert({
    org_id: input.orgId,
    key_id: input.keyId,
    nonce: input.offer.nonce,
    purpose: input.purpose,
    tool_name: input.toolName ?? null,
    credits: input.offer.credits,
    amount_atomic: input.offer.requirements.maxAmountRequired,
    amount_usd: input.offer.usd,
    asset: input.offer.config.assetName,
    network: input.offer.config.network,
    pay_to: input.offer.config.payTo,
    request_id: input.requestId,
    status: "pending",
  });
}

/** Credits the ledger for a settled payment. Idempotent on the tx hash. */
export async function creditSettledPayment(
  admin: SupabaseClient,
  input: {
    orgId: string;
    keyId: string | null;
    offer: PaymentOffer;
    payer: string | null;
    txHash: string | null;
    purpose: "tool_call" | "topup";
    toolName?: string | null;
    requestId: string;
  },
): Promise<{ credited: boolean }> {
  const externalRef = input.txHash ?? input.offer.nonce;

  const { error } = await admin.from("credit_ledger").insert({
    org_id: input.orgId,
    delta: input.offer.credits,
    kind: "topup",
    source: "x402",
    external_ref: externalRef,
    description: `x402 payment — ${input.offer.credits} credits for $${input.offer.usd.toFixed(2)} ${input.offer.config.assetName}`,
  });

  // A unique violation means this payment was already credited: still a success.
  const credited = !error;

  await admin.from("payment_intents").upsert(
    {
      org_id: input.orgId,
      key_id: input.keyId,
      nonce: input.offer.nonce,
      purpose: input.purpose,
      tool_name: input.toolName ?? null,
      credits: input.offer.credits,
      amount_atomic: input.offer.requirements.maxAmountRequired,
      amount_usd: input.offer.usd,
      asset: input.offer.config.assetName,
      network: input.offer.config.network,
      pay_to: input.offer.config.payTo,
      request_id: input.requestId,
      status: "settled",
      payer: input.payer,
      tx_hash: input.txHash,
      settled_at: new Date().toISOString(),
    },
    { onConflict: "nonce" },
  );

  return { credited };
}

export async function markIntentFailed(admin: SupabaseClient, nonce: string, message: string) {
  await admin
    .from("payment_intents")
    .update({ status: "failed", error: message.slice(0, 500) })
    .eq("nonce", nonce);
}

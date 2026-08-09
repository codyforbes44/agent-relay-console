import { PUBLIC_TOOLS } from "@/lib/agent/contracts";
import { CREDIT_PACKS, USD_PER_CREDIT, usdForCredits } from "@/lib/billing/packs";

export type ToolPrice = {
  name: string;
  label: string;
  credits: number;
  usdPerCall: number;
  sideEffecting: boolean;
  demo: boolean;
};

export type PricingDocument = {
  ok: true;
  unit: "credit";
  currency: "USD";
  usdPerCredit: number;
  freeGrant: number;
  packs: Array<{
    priceId: string;
    label: string;
    credits: number;
    usd: number;
    usdPerCredit: number;
  }>;
  tools: ToolPrice[];
  purchase: {
    machine: { url: string; method: "POST"; protocol: "x402"; asset: "USDC"; networks: string[] };
    human: { url: string };
  };
};

/** Single machine-readable source of truth for what a call costs in USD. */
export function pricingDocument(origin: string): PricingDocument {
  return {
    ok: true,
    unit: "credit",
    currency: "USD",
    usdPerCredit: USD_PER_CREDIT,
    freeGrant: 500,
    packs: CREDIT_PACKS.map((p) => ({
      priceId: p.priceId,
      label: p.label,
      credits: p.credits,
      usd: p.amountCents / 100,
      usdPerCredit: Math.round((p.amountCents / 100 / p.credits) * 1e6) / 1e6,
    })),
    tools: PUBLIC_TOOLS.map((t) => ({
      name: t.name,
      label: t.label,
      credits: t.credits,
      usdPerCall: usdForCredits(t.credits),
      sideEffecting: t.sideEffecting,
      demo: t.demo,
    })),
    purchase: {
      machine: {
        url: `${origin}/api/public/v1/credits/purchase`,
        method: "POST",
        protocol: "x402",
        asset: "USDC",
        networks: ["base"],
      },
      human: { url: `${origin}/pricing` },
    },
  };
}

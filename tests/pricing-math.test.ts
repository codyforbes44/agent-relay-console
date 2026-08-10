import { describe, expect, it } from "vitest";

import { toAtomic } from "@/lib/api/x402.server";
import {
  CREDIT_PACKS,
  MACHINE_TOPUP_MIN_CREDITS,
  USD_PER_CREDIT,
  usdForCredits,
} from "@/lib/billing/packs";

describe("usdForCredits", () => {
  it("prices the entry pack exactly at its list price", () => {
    expect(usdForCredits(1000)).toBe(9);
  });

  it("rounds up to the cent so we never undercharge", () => {
    // 1 credit at $0.009 → $0.01, not $0.009 truncated to $0.00.
    expect(usdForCredits(1)).toBe(0.01);
    expect(usdForCredits(111)).toBe(Math.ceil(111 * USD_PER_CREDIT * 100) / 100);
  });

  it("prices the minimum machine top-up above zero", () => {
    expect(usdForCredits(MACHINE_TOPUP_MIN_CREDITS)).toBeGreaterThan(0);
  });
});

describe("toAtomic (USD → USDC 6-decimal units)", () => {
  it("converts whole dollars", () => {
    expect(toAtomic(9, 6)).toBe("9000000");
  });

  it("converts cents exactly without float drift", () => {
    expect(toAtomic(0.9, 6)).toBe("900000");
    expect(toAtomic(1.49, 6)).toBe("1490000");
    // 0.1 + 0.2 style drift must not leak into on-chain amounts.
    expect(toAtomic(0.3, 6)).toBe("300000");
  });

  it("rounds sub-cent amounts up, never down", () => {
    expect(Number(toAtomic(0.001, 6))).toBeGreaterThanOrEqual(10000);
  });
});

describe("credit packs", () => {
  it("gives better per-credit pricing on larger packs", () => {
    const rates = CREDIT_PACKS.map((p) => p.amountCents / p.credits);
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i]!).toBeLessThan(rates[i - 1]!);
    }
  });

  it("uses unique pack ids", () => {
    const ids = CREDIT_PACKS.map((p) => p.priceId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

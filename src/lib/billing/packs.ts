/** Credit packs sold through self-serve checkout. Price IDs are human-readable
 *  and identical across test and live environments. */
export type CreditPack = {
  priceId: string;
  credits: number;
  amountCents: number;
  label: string;
  blurb: string;
};

export const CREDIT_PACKS: CreditPack[] = [
  {
    priceId: "credits_1k",
    credits: 1_000,
    amountCents: 900,
    label: "Starter",
    blurb: "1,000 credits — good for ~1,000 read calls.",
  },
  {
    priceId: "credits_5k",
    credits: 5_000,
    amountCents: 3_900,
    label: "Builder",
    blurb: "5,000 credits — best value for steady agent traffic.",
  },
  {
    priceId: "credits_25k",
    credits: 25_000,
    amountCents: 14_900,
    label: "Scale",
    blurb: "25,000 credits — production fleets and bursty workloads.",
  },
];

export const CREDITS_BY_PRICE_ID: Record<string, number> = Object.fromEntries(
  CREDIT_PACKS.map((p) => [p.priceId, p.credits]),
);

export function formatUsd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

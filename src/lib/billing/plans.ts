/**
 * Monthly subscription plans sold by Agent Relay Console. `planId` is a
 * stable, human-readable identifier referenced by Stripe subscription
 * metadata, the webhook, docs, and pricing copy.
 *
 * Each plan grants `monthlyCredits` on every successful renewal. Unused
 * credits roll over into the next period, capped at `rolloverCap`
 * (subscription credits are treated as consumed first — see
 * computePeriodGrant in @/lib/api/subscriptions.server).
 */
export type RelayPlan = {
  planId: string;
  name: string;
  tagline: string;
  amountCents: number;
  monthlyCredits: number;
  rolloverCap: number;
  features: string[];
};

export const RELAY_PLANS: RelayPlan[] = [
  {
    planId: "relay_starter",
    name: "Starter",
    tagline: "For trying agents in production.",
    amountCents: 2900,
    monthlyCredits: 3_500,
    rolloverCap: 3_500,
    features: [
      "3,500 credits every month",
      "Unused credits roll over (up to 3,500)",
      "All 17 tools, including side-effecting calls",
      "Async human-approval inbox",
    ],
  },
  {
    planId: "relay_pro",
    name: "Pro",
    tagline: "For agents that run every day.",
    amountCents: 9900,
    monthlyCredits: 15_000,
    rolloverCap: 15_000,
    features: [
      "15,000 credits every month",
      "Unused credits roll over (up to 15,000)",
      "All 17 tools, including side-effecting calls",
      "Async human-approval inbox + webhooks",
      "Priority support",
    ],
  },
  {
    planId: "relay_scale",
    name: "Scale",
    tagline: "For fleets and production workloads.",
    amountCents: 29900,
    monthlyCredits: 60_000,
    rolloverCap: 60_000,
    features: [
      "60,000 credits every month",
      "Unused credits roll over (up to 60,000)",
      "All 17 tools, including side-effecting calls",
      "Async human-approval inbox + webhooks",
      "Priority support + onboarding help",
    ],
  },
];

export const PLAN_BY_ID: Record<string, RelayPlan> = Object.fromEntries(
  RELAY_PLANS.map((p) => [p.planId, p]),
);

/** Subscription states that count as "currently subscribed" for gating. */
export const ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"] as const;

export function isActiveSubscriptionStatus(status: string): boolean {
  return (ACTIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);
}

import { createFileRoute, Link } from "@tanstack/react-router";

import { PublicShell } from "@/components/public/PublicShell";
import { Button } from "@/components/ui/button";
import { PUBLIC_TOOLS } from "@/lib/agent/contracts";
import { CREDIT_PACKS, formatUsd } from "@/lib/billing/packs";
import { RELAY_PLANS } from "@/lib/billing/plans";
import { publicHead } from "@/lib/site";

const FAQ = [
  {
    q: "Do credits expire?",
    a: "One-time credit packs never expire — the balance stays on your workspace until it is used. Monthly plans grant fresh credits on every renewal, and unused plan credits roll over up to one month's allotment.",
  },
  {
    q: "Is there a subscription or minimum?",
    a: "No minimum. You can buy one-time packs as needed, or take a monthly plan if your agents run steadily — plans are cheaper per credit and unused credits roll over. Every new workspace also starts with 500 free credits.",
  },
  {
    q: "What does one credit buy?",
    a: "Credits are charged per successful tool call at the rates listed below — read-only lookups cost 1 credit, side-effecting actions cost more.",
  },
  {
    q: "Am I charged for failed calls?",
    a: "No. Validation errors, rate limits, unknown tools and internal errors are not charged. Only successful calls debit credits.",
  },
  {
    q: "How do I pay?",
    a: "Agent Relay Console sells credits directly. Pay by card from the console billing page, or settle in USDC on Base over the x402 protocol — an agent can top itself up with no human in the loop. For larger purchases we can invoice instead; contact support@3bi.ai.",
  },
];

export const Route = createFileRoute("/pricing")({
  head: () => {
    const base = publicHead({
      path: "/pricing",
      title: "Pricing — RELAY monthly plans from $29/mo and credit packs from $9",
      description:
        "Monthly plans and pay-as-you-go credit packs for the Agent Relay Console tool API: plans from $29/mo with rollover, packs from $9 with credits that never expire.",
    });
    return {
      ...base,
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: FAQ.map((f) => ({
              "@type": "Question",
              name: f.q,
              acceptedAnswer: { "@type": "Answer", text: f.a },
            })),
          }),
        },
      ],
    };
  },
  component: PricingPage,
});

function PricingPage() {
  return (
    <PublicShell>
      <main className="mx-auto w-full max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Pricing</h1>
        <p className="mt-3 text-muted-foreground">
          Agent Relay Console sells credits, and each successful tool call debits credits from your
          workspace balance. Run agents steadily on a monthly plan — cheaper per credit, with unused
          credits rolling over — or buy one-time packs that never expire. New workspaces start with
          500 free credits.
        </p>

        <h2 className="mt-10 text-lg font-medium text-foreground">Monthly plans</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {RELAY_PLANS.map((plan, i) => (
            <div
              key={plan.planId}
              className={`rounded-lg border p-5 ${
                i === 1 ? "border-primary bg-primary/5" : "border-border bg-card"
              }`}
            >
              {i === 1 ? (
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
                  Most popular
                </span>
              ) : null}
              <p className="mt-1 text-sm font-medium text-foreground">{plan.name}</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">
                {formatUsd(plan.amountCents)}
                <span className="text-sm font-normal text-muted-foreground">/mo</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {plan.monthlyCredits.toLocaleString()} credits/mo · $
                {((plan.amountCents / 100 / plan.monthlyCredits) * 1000).toFixed(2)} per 1k
              </p>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{plan.tagline}</p>
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                {plan.features.map((f) => (
                  <li key={f}>· {f}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Plans renew monthly and unused credits roll over up to one month's allotment. Cancel
          anytime — your balance stays until it is used.{" "}
          <Link to="/billing" className="underline underline-offset-2">
            Subscribe from the console billing page
          </Link>
          .
        </p>

        <h2 className="mt-10 text-lg font-medium text-foreground">Credit packs</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {CREDIT_PACKS.map((pack, i) => (
            <div
              key={pack.priceId}
              className={`rounded-lg border p-5 ${
                i === 1 ? "border-primary bg-primary/5" : "border-border bg-card"
              }`}
            >
              {i === 1 ? (
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
                  Most popular
                </span>
              ) : null}
              <p className="mt-1 text-sm font-medium text-foreground">{pack.label}</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">
                {formatUsd(pack.amountCents)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {pack.credits.toLocaleString()} credits · $
                {((pack.amountCents / 100 / pack.credits) * 1000).toFixed(2)} per 1k
              </p>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{pack.blurb}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Prices are in US dollars and exclude any sales tax or VAT. Agent Relay Console sells
          credits directly; payments settle in USDC on Base over x402, or by invoice on request.
        </p>

        <h2 className="mt-10 text-lg font-medium text-foreground">Credit cost per tool call</h2>
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {PUBLIC_TOOLS.map((t) => (
            <li key={t.name} className="flex items-start justify-between gap-4 px-4 py-3">
              <div>
                <p className="font-mono text-sm text-foreground">
                  {t.name}
                  {t.sideEffecting ? (
                    <span className="ml-2 rounded-full border border-border px-2 py-0.5 font-sans text-[10px] uppercase tracking-wide text-muted-foreground">
                      confirm
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-muted-foreground">{t.description}</p>
              </div>
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary">
                {t.credits} cr
              </span>
            </li>
          ))}
        </ul>

        <h2 className="mt-10 text-lg font-medium text-foreground">Questions</h2>
        <dl className="mt-3 divide-y divide-border rounded-lg border border-border">
          {FAQ.map((f) => (
            <div key={f.q} className="px-4 py-3">
              <dt className="text-sm font-medium text-foreground">{f.q}</dt>
              <dd className="mt-1 text-xs leading-relaxed text-muted-foreground">{f.a}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild>
            <Link to="/auth">Create an account</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/docs">Read the API docs</Link>
          </Button>
        </div>
      </main>
    </PublicShell>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";

import { PublicShell } from "@/components/public/PublicShell";
import { Button } from "@/components/ui/button";
import { PUBLIC_TOOLS } from "@/lib/agent/contracts";
import { CREDIT_PACKS, formatUsd } from "@/lib/billing/packs";
import { publicHead } from "@/lib/site";

const FAQ = [
  {
    q: "Do credits expire?",
    a: "No. Credit packs are one-time purchases and the balance stays on your workspace until it is used.",
  },
  {
    q: "Is there a subscription or minimum?",
    a: "No. You buy a pack when you need one. Every new workspace also starts with 500 free credits.",
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
    a: "Agent Relay Console sells credits directly. Payments are settled in USDC on Base over the x402 protocol — an agent can top itself up with no human in the loop — or by invoice for larger purchases. Contact support@3bi.ai for invoicing.",
  },
];

export const Route = createFileRoute("/pricing")({
  head: () => {
    const base = publicHead({
      path: "/pricing",
      title: "Pricing — RELAY credit packs from $9",
      description:
        "Pay-as-you-go credit packs for the Agent Relay Console tool API: 1,000 credits for $9, 5,000 for $39, 25,000 for $149. No subscription, credits never expire.",
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
          Agent Relay Console is pay-as-you-go. You buy credits once, and each successful tool call
          debits credits from your workspace balance. There is no subscription and credits do not
          expire. New workspaces start with 500 free credits.
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
          Prices are in US dollars and exclude any sales tax or VAT, which is calculated at
          checkout. Our order process is conducted by our online reseller Paddle.com, the Merchant
          of Record for all orders.
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

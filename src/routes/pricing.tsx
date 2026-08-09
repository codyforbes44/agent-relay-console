import { createFileRoute, Link } from "@tanstack/react-router";

import { LegalFooter } from "@/components/LegalFooter";
import { Button } from "@/components/ui/button";
import { CREDIT_PACKS, formatUsd } from "@/lib/billing/packs";
import { PUBLIC_TOOLS } from "@/lib/agent/contracts";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — Agent Relay Console credit packs" },
      {
        name: "description",
        content:
          "Pay-as-you-go credit packs for the Agent Relay Console tool API: 1,000 credits for $9, 5,000 for $39, 25,000 for $149. No subscription.",
      },
      { property: "og:title", content: "Pricing — Agent Relay Console credit packs" },
      {
        property: "og:description",
        content: "Credit packs from $9. Per-tool-call credit costs listed in full.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PricingPage,
});

function PricingPage() {
  return (
    <>
      <main className="mx-auto w-full max-w-3xl px-6 py-16">
        <span className="font-mono text-[11px] tracking-[0.3em] text-primary">RELAY</span>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Pricing</h1>
        <p className="mt-3 text-muted-foreground">
          Agent Relay Console is pay-as-you-go. You buy credits once, and each tool call debits
          credits from your workspace balance. There is no subscription and credits do not expire.
          New workspaces start with 500 free credits.
        </p>

        <h2 className="mt-10 text-lg font-medium text-foreground">Credit packs</h2>
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {CREDIT_PACKS.map((pack) => (
            <li key={pack.priceId} className="flex items-start justify-between gap-4 px-4 py-4">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {pack.label} — {pack.credits.toLocaleString()} credits
                </p>
                <p className="text-xs text-muted-foreground">{pack.blurb}</p>
              </div>
              <span className="shrink-0 text-base font-semibold text-foreground">
                {formatUsd(pack.amountCents)}
              </span>
            </li>
          ))}
        </ul>
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
                <p className="font-mono text-sm text-foreground">{t.name}</p>
                <p className="text-xs text-muted-foreground">{t.description}</p>
              </div>
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary">
                {t.credits} cr
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-8 flex gap-3">
          <Button asChild>
            <Link to="/auth">Create an account</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/docs">Read the API docs</Link>
          </Button>
        </div>
      </main>
      <LegalFooter />
    </>
  );
}

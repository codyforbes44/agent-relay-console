import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Copy, Loader2 } from "lucide-react";
import { useState } from "react";

import { ConsoleShell } from "@/components/workspace/ConsoleShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAccountSummary } from "@/lib/api/keys.functions";
import { CREDIT_PACKS, formatUsd } from "@/lib/billing/packs";
import { SITE_URL } from "@/lib/site";

const SUPPORT_EMAIL = "support@3bi.ai";

export const Route = createFileRoute("/_authenticated/billing")({
  head: () => ({
    meta: [
      { title: "Buy credits — Relay Agent Tool API" },
      {
        name: "description",
        content:
          "Top up your Relay workspace with credit packs, settled in USDC over x402 or by invoice.",
      },
      { property: "og:title", content: "Buy credits — Relay Agent Tool API" },
      { property: "og:description", content: "Credit packs for agent tool calls, paid in USDC." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BillingPage,
});

function BillingPage() {
  return (
    <ConsoleShell
      title="Buy credits"
      description="Credits are consumed per metered tool call. Packs never expire."
    >
      {(org) => <BillingPanel orgId={org.id} />}
    </ConsoleShell>
  );
}

function topupCommand(credits: number) {
  return `curl -X POST ${SITE_URL}/api/public/v1/credits/purchase \\
  -H "Authorization: Bearer $RELAY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"credits": ${credits}}'`;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? "Copied" : "Copy top-up call"}
    </Button>
  );
}

function BillingPanel({ orgId }: { orgId: string }) {
  const summary = useServerFn(getAccountSummary);

  const { data, isLoading } = useQuery({
    queryKey: ["usage", orgId],
    queryFn: () => summary({ data: { orgId } }),
    refetchInterval: 15_000,
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardDescription>Current balance</CardDescription>
          <CardTitle className="text-3xl tabular-nums">
            {isLoading ? (
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            ) : data?.unlimited ? (
              "Unlimited"
            ) : (
              `${(data?.balance ?? 0).toLocaleString()} credits`
            )}
          </CardTitle>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">How to pay</CardTitle>
          <CardDescription>
            Credits are sold directly by Agent Relay Console and settled in USDC on Base over x402.
            Run the top-up call below with one of your workspace API keys — the first response is an
            HTTP 402 offer, and once it is settled the credits land on this balance. For larger
            purchases we can invoice instead.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" asChild>
            <a href={`mailto:${SUPPORT_EMAIL}?subject=Credit%20purchase%20by%20invoice`}>
              Pay by invoice
            </a>
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        {CREDIT_PACKS.map((pack) => (
          <Card key={pack.priceId} className="flex flex-col">
            <CardHeader>
              <CardDescription className="font-mono text-xs uppercase tracking-[0.2em]">
                {pack.label}
              </CardDescription>
              <CardTitle className="text-2xl">{pack.credits.toLocaleString()}</CardTitle>
            </CardHeader>
            <CardContent className="mt-auto space-y-4">
              <p className="text-sm text-muted-foreground">{pack.blurb}</p>
              <p className="text-lg font-semibold text-foreground">
                {formatUsd(pack.amountCents)}{" "}
                <span className="text-xs font-normal text-muted-foreground">in USDC</span>
              </p>
              <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
                <code>{topupCommand(pack.credits)}</code>
              </pre>
              <CopyButton value={topupCommand(pack.credits)} />
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Credits land in your workspace balance as soon as the payment settles on-chain. Machine API
        calls that exceed your balance return HTTP 402 with a payable offer.
      </p>
    </div>
  );
}

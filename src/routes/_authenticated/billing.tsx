import { authRedirectUrl } from "@/lib/site";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";

import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { ConsoleShell } from "@/components/workspace/ConsoleShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { getAccountSummary } from "@/lib/api/keys.functions";
import { CREDIT_PACKS, formatUsd } from "@/lib/billing/packs";
import { usePaddleCheckout } from "@/hooks/usePaddleCheckout";

export const Route = createFileRoute("/_authenticated/billing")({
  head: () => ({
    meta: [
      { title: "Buy credits — Relay Agent Tool API" },
      {
        name: "description",
        content:
          "Top up your Relay workspace with credit packs. Credits are spent per metered agent tool call.",
      },
      { property: "og:title", content: "Buy credits — Relay Agent Tool API" },
      { property: "og:description", content: "Self-serve credit packs for agent tool calls." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BillingPage,
});

function BillingPage() {
  return (
    <>
      <PaymentTestModeBanner />
      <ConsoleShell
        title="Buy credits"
        description="Credits are consumed per metered tool call. Packs never expire."
      >
        {(org) => <BillingPanel orgId={org.id} />}
      </ConsoleShell>
    </>
  );
}

function BillingPanel({ orgId }: { orgId: string }) {
  const summary = useServerFn(getAccountSummary);
  const { openCheckout, loading } = usePaddleCheckout();

  const { data, isLoading } = useQuery({
    queryKey: ["usage", orgId],
    queryFn: () => summary({ data: { orgId } }),
    refetchInterval: 15_000,
  });

  async function buy(priceId: string) {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    await openCheckout({
      priceId,
      customerEmail: user?.email ?? undefined,
      customData: { orgId, userId: user?.id ?? "" },
      successUrl: authRedirectUrl("/usage?checkout=success"),
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardDescription>Current balance</CardDescription>
          <CardTitle className="text-3xl tabular-nums">
            {isLoading ? (
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            ) : (
              `${(data?.balance ?? 0).toLocaleString()} credits`
            )}
          </CardTitle>
        </CardHeader>
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
              <p className="text-lg font-semibold text-foreground">{formatUsd(pack.amountCents)}</p>
              <Button className="w-full" disabled={loading} onClick={() => buy(pack.priceId)}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : "Buy pack"}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Credits land in your workspace balance as soon as the payment clears. Machine API calls that
        exceed your balance return HTTP 402 with a link back here.
      </p>
    </div>
  );
}

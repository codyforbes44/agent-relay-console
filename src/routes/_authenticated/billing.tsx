import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Copy, CreditCard, Loader2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { ConsoleShell } from "@/components/workspace/ConsoleShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAccountSummary } from "@/lib/api/keys.functions";
import { createCreditCheckout, isCardCheckoutEnabled } from "@/lib/billing/checkout.functions";
import {
  createPlanCheckout,
  createPortalSession,
  getSubscriptionSummary,
  listPlans,
} from "@/lib/billing/subscription.functions";
import { CREDIT_PACKS, formatUsd } from "@/lib/billing/packs";
import { SITE_URL } from "@/lib/site";

const SUPPORT_EMAIL = "support@3bi.ai";

const searchSchema = z.object({
  checkout: z.enum(["success", "cancel"]).optional(),
  plan: z.enum(["success", "cancel"]).optional(),
});

export const Route = createFileRoute("/_authenticated/billing")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Billing — Relay Agent Tool API" },
      {
        name: "description",
        content:
          "Monthly plans and one-time credit packs for your Relay workspace — pay by card, in USDC over x402, or by invoice.",
      },
      { property: "og:title", content: "Billing — Relay Agent Tool API" },
      {
        property: "og:description",
        content: "Monthly plans and credit packs for agent tool calls.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BillingPage,
});

function BillingPage() {
  return (
    <ConsoleShell
      title="Billing"
      description="Monthly plans for steady agent traffic, or one-time credit packs that never expire."
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
      variant="ghost"
      size="sm"
      className="w-full"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? "Copied" : "Copy x402 top-up call"}
    </Button>
  );
}

function CheckoutBanner() {
  const { checkout, plan } = Route.useSearch();
  const result = checkout ?? plan;
  if (!result) return null;
  if (result === "success") {
    return (
      <Alert>
        <AlertTitle>Payment received</AlertTitle>
        <AlertDescription>
          {plan === "success"
            ? "Your subscription is active — the first month's credits will appear on the balance above within a few seconds. This page refreshes automatically."
            : "Your credits will appear on the balance above within a few seconds. This page refreshes automatically."}
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert>
      <AlertTitle>Checkout cancelled</AlertTitle>
      <AlertDescription>No payment was taken. Pick a pack or plan to try again.</AlertDescription>
    </Alert>
  );
}

function BillingPanel({ orgId }: { orgId: string }) {
  const summary = useServerFn(getAccountSummary);
  const cardEnabled = useServerFn(isCardCheckoutEnabled);
  const startCheckout = useServerFn(createCreditCheckout);
  const fetchPlans = useServerFn(listPlans);
  const fetchSubscription = useServerFn(getSubscriptionSummary);
  const startPlanCheckout = useServerFn(createPlanCheckout);
  const startPortal = useServerFn(createPortalSession);

  const { data, isLoading } = useQuery({
    queryKey: ["usage", orgId],
    queryFn: () => summary({ data: { orgId } }),
    refetchInterval: 15_000,
  });

  const { data: card } = useQuery({
    queryKey: ["card-checkout-enabled"],
    queryFn: () => cardEnabled(),
    staleTime: Infinity,
  });

  const { data: plansData } = useQuery({
    queryKey: ["plans"],
    queryFn: () => fetchPlans(),
    staleTime: Infinity,
  });

  const { data: subscriptionData } = useQuery({
    queryKey: ["subscription", orgId],
    queryFn: () => fetchSubscription({ data: { orgId } }),
    refetchInterval: 60_000,
  });

  const checkout = useMutation({
    mutationFn: (priceId: string) => startCheckout({ data: { orgId, priceId } }),
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
  });

  const planCheckout = useMutation({
    mutationFn: (planId: string) => startPlanCheckout({ data: { orgId, planId } }),
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
  });

  const portal = useMutation({
    mutationFn: () => startPortal({ data: { orgId } }),
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
  });

  const subscription = subscriptionData?.subscription ?? null;
  const plans = plansData?.plans ?? [];

  return (
    <div className="space-y-6">
      <CheckoutBanner />

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
          {subscription ? (
            <CardDescription className="pt-1">
              {subscription.planName} plan
              {subscription.renewsAt
                ? ` · renews ${new Date(subscription.renewsAt).toLocaleDateString()}`
                : ""}
              {subscription.cancelAtPeriodEnd ? " · cancels at period end" : ""}
            </CardDescription>
          ) : null}
        </CardHeader>
        {subscription ? (
          <CardContent>
            <Button variant="outline" disabled={portal.isPending} onClick={() => portal.mutate()}>
              {portal.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CreditCard className="size-4" />
              )}
              Manage subscription
            </Button>
            {portal.isError ? (
              <p className="mt-2 text-sm text-destructive">
                {portal.error instanceof Error ? portal.error.message : "Please try again."}
              </p>
            ) : null}
          </CardContent>
        ) : null}
      </Card>

      {planCheckout.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Subscription checkout failed</AlertTitle>
          <AlertDescription>
            {planCheckout.error instanceof Error ? planCheckout.error.message : "Please try again."}
          </AlertDescription>
        </Alert>
      ) : null}

      {!subscription && card?.enabled && plans.length > 0 ? (
        <>
          <h2 className="text-lg font-medium text-foreground">Monthly plans</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {plans.map((plan, i) => (
              <Card
                key={plan.planId}
                className={`flex flex-col ${i === 1 ? "border-primary" : ""}`}
              >
                <CardHeader>
                  <CardDescription className="font-mono text-xs uppercase tracking-[0.2em]">
                    {plan.name}
                    {i === 1 ? " · most popular" : ""}
                  </CardDescription>
                  <CardTitle className="text-2xl">
                    {formatUsd(plan.amountCents)}
                    <span className="text-sm font-normal text-muted-foreground">/mo</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="mt-auto space-y-4">
                  <p className="text-sm text-muted-foreground">{plan.tagline}</p>
                  <ul className="space-y-1.5 text-sm">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="w-full"
                    disabled={planCheckout.isPending}
                    onClick={() => planCheckout.mutate(plan.planId)}
                  >
                    {planCheckout.isPending && planCheckout.variables === plan.planId ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <CreditCard className="size-4" />
                    )}
                    Subscribe
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Plans grant credits on every monthly renewal. Unused credits roll over, up to one
            month's allotment. Cancel anytime from the customer portal — your balance stays until it
            is used.
          </p>

          <h2 className="text-lg font-medium text-foreground">One-time credit packs</h2>
        </>
      ) : null}

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
              {card?.enabled ? (
                <Button
                  className="w-full"
                  disabled={checkout.isPending}
                  onClick={() => checkout.mutate(pack.priceId)}
                >
                  {checkout.isPending && checkout.variables === pack.priceId ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CreditCard className="size-4" />
                  )}
                  Pay by card
                </Button>
              ) : null}
              <CopyButton value={topupCommand(pack.credits)} />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Other ways to pay</CardTitle>
          <CardDescription>
            Agents top themselves up in USDC on Base over x402: the copy button on each pack gives
            the exact call, the first response is an HTTP 402 offer, and once it settles the credits
            land on this balance. For larger purchases we can invoice instead.
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

      <p className="text-xs text-muted-foreground">
        Credits land in your workspace balance as soon as the payment settles. Machine API calls
        that exceed your balance return HTTP 402 with a payable offer.
      </p>
    </div>
  );
}

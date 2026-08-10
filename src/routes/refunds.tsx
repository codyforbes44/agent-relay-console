import { createFileRoute } from "@tanstack/react-router";

import { LegalNav } from "@/components/public/LegalNav";
import { PublicShell } from "@/components/public/PublicShell";
import { publicHead } from "@/lib/site";

export const Route = createFileRoute("/refunds")({
  head: () =>
    publicHead({
      path: '/refunds',
      title: 'Refund Policy — RELAY',
      description:
        'Agent Relay Console offers a 30-day money-back guarantee on credit pack purchases. Refunds are issued directly by us in USDC.',
    }),
  component: RefundsPage,
});

function RefundsPage() {
  return (
    <PublicShell>
      <main className="mx-auto w-full max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Refund Policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: 9 August 2026</p>
        <LegalNav current="/refunds" />

        <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted-foreground">
          <p>
            Agent Relay Console offers a <strong className="text-foreground">30-day
            money-back guarantee</strong> on credit pack purchases. If you are not satisfied with
            your purchase, you can request a full refund within 30 days of your order date.
          </p>

          <div>
            <h2 className="mb-2 text-base font-medium text-foreground">How to request a refund</h2>
            <p>
              Agent Relay Console sells credits directly and handles all refunds itself. To request
              one, email{" "}
              <a className="underline" href="mailto:support@3bi.ai">
                support@3bi.ai
              </a>{" "}
              with your workspace name and the purchase date, or contact us through the support
              channel listed in your console. We aim to respond within two business days.
            </p>
          </div>

          <div>
            <h2 className="mb-2 text-base font-medium text-foreground">How refunds are issued</h2>
            <p>
              Approved refunds are returned in USDC to the wallet address that paid for the
              purchase, or as a credit note against your invoice if you paid by invoice. Any credits
              granted by the refunded purchase are removed from your workspace balance. On-chain
              refunds usually settle within one business day of approval.
            </p>
          </div>


          <div>
            <h2 className="mb-2 text-base font-medium text-foreground">Free credits</h2>
            <p>
              Free starter credits and any promotional credits carry no monetary value and are not
              refundable, as no payment is made for them.
            </p>
          </div>
        </div>
      </main>
    </PublicShell>
  );
}

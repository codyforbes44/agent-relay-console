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
        'Agent Relay Console offers a 30-day money-back guarantee on credit pack purchases. Refunds are processed by Paddle, our Merchant of Record.',
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
              Our order process is conducted by our online reseller Paddle.com. Paddle.com is the
              Merchant of Record for all our orders and handles refunds on our behalf. To request a
              refund, visit{" "}
              <a
                className="underline"
                href="https://paddle.net"
                target="_blank"
                rel="noopener noreferrer"
              >
                paddle.net
              </a>{" "}
              with your order details, or contact Agent Relay Console support through the channel
              listed in your console and we will pass the request on.
            </p>
          </div>

          <div>
            <h2 className="mb-2 text-base font-medium text-foreground">How refunds are issued</h2>
            <p>
              Approved refunds are returned to the original payment method. Any credits granted by
              the refunded purchase are removed from your workspace balance. Processing times
              depend on your bank or card issuer and are typically a few business days after
              approval.
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

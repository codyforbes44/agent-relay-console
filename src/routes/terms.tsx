import { createFileRoute } from "@tanstack/react-router";

import { PublicShell } from "@/components/public/PublicShell";
import { publicHead } from "@/lib/site";

export const Route = createFileRoute("/terms")({
  head: () =>
    publicHead({
      path: '/terms',
      title: 'Terms & Conditions — Agent Relay Console',
      description:
        'The terms governing use of the Agent Relay Console metered agent tool API, including acceptable use, IP ownership, billing and termination.',
    }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <PublicShell>
      <main className="mx-auto w-full max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Terms &amp; Conditions
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: 9 August 2026</p>

        <div className="prose-sm mt-8 space-y-8 text-sm leading-relaxed text-muted-foreground">
          <Section title="1. Who you are contracting with">
            <p>
              These terms are an agreement between you and Agent Relay Console (&quot;Agent Relay
              Console&quot;, &quot;we&quot;, &quot;us&quot;), the provider of the Agent Relay
              Console metered tool API, MCP server and web console (the &quot;Service&quot;). By
              creating an account, minting an API key, or continuing to use the Service, you agree
              to these terms. If you accept on behalf of an organisation, you confirm you have
              authority to bind it; if you accept as an individual, you confirm you are of legal
              age.
            </p>
          </Section>

          <Section title="2. The Service">
            <p>
              The Service exposes a catalog of tools that can be called over HTTP or Model Context
              Protocol by you or by autonomous agents acting for you. Each call debits credits from
              your workspace balance at the rates published on our pricing page. Tools marked as
              demo return simulated fixture data and are labelled as such in every response.
            </p>
          </Section>

          <Section title="3. Your account and credentials">
            <p>
              You must provide accurate account information and keep it up to date. API keys are
              bearer credentials: you are responsible for keeping them confidential and for all
              activity and credit consumption under your keys, including calls made by agents you
              configure. Revoke a compromised key immediately from the console.
            </p>
          </Section>

          <Section title="4. Acceptable use">
            <p>You must not use the Service to:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>break any applicable law or regulation;</li>
              <li>commit fraud, send spam, or send unsolicited or deceptive messages;</li>
              <li>infringe intellectual property or privacy rights of others;</li>
              <li>
                interfere with the security or integrity of the Service, including probing,
                scanning, distributing malware, circumventing rate limits or credit metering, or
                scraping beyond documented endpoints;
              </li>
              <li>resell, redistribute or reverse engineer the Service.</li>
            </ul>
            <p className="mt-2">
              You are responsible for the inputs your agents send, for verifying outputs before
              acting on them, and for having the rights to any content you submit. Side-effecting
              tools require an explicit per-call confirmation; you are responsible for the
              real-world effects of any call you or your agents confirm.
            </p>
          </Section>

          <Section title="5. Intellectual property">
            <p>
              We retain all right, title and interest in the Service, including its software,
              documentation, tool catalog and branding. You receive a limited, non-exclusive,
              non-transferable right to use the Service in accordance with these terms and your
              credit balance. You retain ownership of the content you submit, and grant us a
              limited licence to host and process it solely to provide the Service.
            </p>
          </Section>

          <Section title="6. Payment, billing and tax">
            <p>
              Credits are sold as one-time packs at the prices shown on our pricing page. Our order
              process is conducted by our online reseller Paddle.com. Paddle.com is the Merchant of
              Record for all our orders. Paddle provides all customer service inquiries and handles
              returns. Payment, billing, tax, cancellation and refund mechanics are governed by
              Paddle&apos;s{" "}
              <a
                className="underline"
                href="https://www.paddle.com/legal/checkout-buyer-terms"
                target="_blank"
                rel="noopener noreferrer"
              >
                Buyer Terms
              </a>
              , together with our refund policy.
            </p>
          </Section>

          <Section title="7. Service levels and warranties">
            <p>
              The Service is provided on an as-is basis. We do not guarantee that it will be
              uninterrupted, error-free, or that tool outputs will be accurate or fit for any
              particular purpose. To the fullest extent permitted by law we disclaim all implied
              warranties, including merchantability and fitness for a particular purpose. Outputs
              are not professional, legal, financial or medical advice.
            </p>
          </Section>

          <Section title="8. Liability">
            <p>
              To the fullest extent permitted by law, our aggregate liability arising out of or
              relating to the Service is limited to the amounts you paid us in the twelve months
              preceding the claim. We are not liable for indirect, consequential or special damages,
              including lost profits, data or goodwill. Nothing in these terms excludes liability
              for fraud, death or personal injury caused by negligence, or any liability that cannot
              be excluded by law. You will indemnify us against claims arising from your content,
              your unlawful use of the Service, or your breach of these terms.
            </p>
          </Section>

          <Section title="9. Suspension and termination">
            <p>
              We may suspend or terminate access for material breach of these terms, non-payment,
              suspected fraud or security risk, or repeated or serious policy violations. You may
              stop using the Service at any time. On termination your access ends; you may export
              your conversation and usage data before closing your account, after which we may
              delete it in line with our privacy notice.
            </p>
          </Section>

          <Section title="10. Changes, assignment and general">
            <p>
              We may update these terms; material changes will be posted on this page with a new
              effective date. You may not assign this agreement without our consent; we may assign
              it in connection with a merger or acquisition. Neither party is liable for delays
              caused by events beyond its reasonable control.
            </p>
          </Section>

          <Section title="11. Contact">
            <p>
              Questions about these terms: contact Agent Relay Console through the support channel
              listed in your console. Billing and refund enquiries are handled by Paddle at{" "}
              <a
                className="underline"
                href="https://paddle.net"
                target="_blank"
                rel="noopener noreferrer"
              >
                paddle.net
              </a>
              .
            </p>
          </Section>
        </div>
      </main>
    </PublicShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-base font-medium text-foreground">{title}</h2>
      {children}
    </section>
  );
}

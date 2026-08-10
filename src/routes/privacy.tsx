import { createFileRoute } from "@tanstack/react-router";

import { LegalNav } from "@/components/public/LegalNav";
import { PublicShell } from "@/components/public/PublicShell";
import { publicHead } from "@/lib/site";

export const Route = createFileRoute("/privacy")({
  head: () =>
    publicHead({
      path: '/privacy',
      title: 'Privacy Notice — RELAY',
      description:
        'How Agent Relay Console collects, uses, shares and retains personal data for its metered agent tool API, and the rights you have over that data.',
    }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <PublicShell>
      <main className="mx-auto w-full max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Privacy Notice</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: 9 August 2026</p>
        <LegalNav current="/privacy" />

        <div className="mt-8 space-y-8 text-sm leading-relaxed text-muted-foreground">
          <Section title="1. Who we are">
            <p>
              Agent Relay Console provides a metered tool API, MCP server and web console for
              autonomous agents. Agent Relay Console is the data controller for the personal data
              described in this notice — we decide why and how it is processed.
            </p>
          </Section>

          <Section title="2. Data we collect and why">
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong className="text-foreground">Account data</strong> (email address, display
                name, login credentials managed by our authentication provider, workspace and
                membership records) — to create and secure your account and workspace. Legal basis:
                performance of our contract with you.
              </li>
              <li>
                <strong className="text-foreground">Content data</strong> (conversations, messages,
                tool call arguments and results you or your agents submit) — to provide the Service
                and show your history. Legal basis: performance of our contract.
              </li>
              <li>
                <strong className="text-foreground">Usage and telemetry</strong> (tool call events,
                credit ledger entries, API key identifiers and last-used timestamps, rate limit
                counters, request IDs, latency, error codes, IP address) — to meter credits, apply
                rate limits, prevent abuse and debug faults. Legal basis: performance of our
                contract and our legitimate interest in a secure, correctly billed service.
              </li>
              <li>
                <strong className="text-foreground">Audit logs</strong> of workspace actions — to
                provide accountability to workspace owners and to investigate security incidents.
                Legal basis: legitimate interests and legal obligations.
              </li>
              <li>
                <strong className="text-foreground">Support correspondence</strong> — to answer your
                questions. Legal basis: legitimate interests.
              </li>
            </ul>
            <p className="mt-2">
              Payment card details are never collected or stored by us; they are handled by our
              Merchant of Record.
            </p>
          </Section>

          <Section title="3. Who we share data with">
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong className="text-foreground">Service providers and subprocessors</strong> —
                cloud hosting, database, authentication and AI model providers that operate the
                Service on our instructions.
              </li>
              <li>
                <strong className="text-foreground">Payment and settlement records</strong> — we
                sell credits directly and record our own billing data. Payments settled in USDC on
                the Base network are recorded on a public blockchain, including the paying wallet
                address, amount and transaction hash; we cannot alter or delete that public record.
              </li>
              <li>
                <strong className="text-foreground">Professional advisers</strong> such as legal and
                accounting firms, where necessary.
              </li>
              <li>
                <strong className="text-foreground">Authorities</strong>, where required by law or
                to establish, exercise or defend legal claims.
              </li>
            </ul>
            <p className="mt-2">We do not sell personal data.</p>
          </Section>

          <Section title="4. International transfers">
            <p>
              Our providers may process data outside your country, including outside the UK and
              EEA. Where that happens we rely on appropriate safeguards such as adequacy decisions
              or Standard Contractual Clauses.
            </p>
          </Section>

          <Section title="5. Retention">
            <p>
              Account, conversation and usage records are kept for as long as your account is
              active. After account closure we delete or anonymise personal data within a
              reasonable period, except where we must keep records longer to meet legal, tax or
              accounting obligations, or to resolve disputes.
            </p>
          </Section>

          <Section title="6. Your rights">
            <p>
              Subject to applicable law, you may request access to your personal data, correction of
              inaccurate data, erasure, restriction of or objection to processing, and portability,
              and you may withdraw consent where processing relies on it. We aim to respond within
              one month. If you are in the UK or EEA you also have the right to complain to your
              local supervisory authority. To exercise a right, contact us through the support
              channel listed in your console.
            </p>
          </Section>

          <Section title="7. Security">
            <p>
              We apply appropriate technical and organisational measures, including encryption in
              transit, tenant-scoped access controls at the database level, hashed API keys, and
              least-privilege access for our systems. No system is perfectly secure, so please keep
              your credentials safe and revoke keys you no longer use.
            </p>
          </Section>

          <Section title="8. Cookies and local storage">
            <p>
              We use strictly necessary cookies and browser storage to keep you signed in and to
              maintain your session. We do not use advertising cookies. You can clear this storage
              in your browser settings, though doing so will sign you out.
            </p>
          </Section>

          <Section title="9. Changes and contact">
            <p>
              We may update this notice; material changes will be posted here with a new effective
              date. For privacy questions, contact Agent Relay Console through the support channel
              listed in your console.
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

import { createFileRoute, Link } from "@tanstack/react-router";
import { KeyRound, Gauge, ShieldCheck, Plug, Terminal, Receipt } from "lucide-react";

import { PublicShell } from "@/components/public/PublicShell";
import { Button } from "@/components/ui/button";
import { PUBLIC_TOOLS } from "@/lib/agent/contracts";
import { CREDIT_PACKS, formatUsd } from "@/lib/billing/packs";
import { SITE_NAME, SITE_URL, SITE_TITLE, SITE_DESCRIPTION, SITE_PRODUCT_NAME, canonical, publicHead } from "@/lib/site";

const TITLE = SITE_TITLE;
const DESCRIPTION = SITE_DESCRIPTION;

export const Route = createFileRoute("/")({
  head: () => {
    const base = publicHead({ path: "/", title: TITLE, description: DESCRIPTION });
    return {
      ...base,
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: SITE_PRODUCT_NAME,
            url: SITE_URL,
            applicationCategory: "DeveloperApplication",
            operatingSystem: "Any",
            description: DESCRIPTION,
            offers: CREDIT_PACKS.map((p) => ({
              "@type": "Offer",
              name: `${p.label} — ${p.credits} credits`,
              price: (p.amountCents / 100).toFixed(2),
              priceCurrency: "USD",
              url: canonical("/pricing"),
            })),
          }),
        },
      ],
    };
  },
  component: Landing,
});

const QUICKSTART = `# 1. sign yourself up (no browser, no email loop)
curl -X POST ${SITE_URL}/api/public/v1/signup \\
  -H "content-type: application/json" \\
  -d '{"label":"my-agent"}'

# 2. discover
curl ${SITE_URL}/api/public/v1/tools

# 3. call a live tool (read-only tools need no confirmation)
curl -X POST ${SITE_URL}/api/public/v1/tools/fetch_url \\
  -H "Authorization: Bearer $RELAY_KEY" \\
  -H "content-type: application/json" \\
  -d '{"url":"https://example.com"}'`;

const STEPS = [
  {
    title: "Sign yourself up",
    body: "One unauthenticated POST returns a bearer key and 500 free credits. No browser, no email loop.",
    code: "POST /api/public/v1/signup",
  },
  {
    title: "Discover the catalog",
    body: "Typed JSON Schema arguments and results, published as OpenAPI 3.1, an agent manifest and MCP.",
    code: "GET /api/public/v1/tools",
  },
  {
    title: "Call and get metered",
    body: "Successful calls debit credits. Side-effecting tools return 428 with a preview until a human-approved token is presented.",
    code: "POST /api/public/v1/tools/{name}",
  },
] as const;


const FEATURES = [
  {
    icon: KeyRound,
    title: "Machine-first onboarding",
    body: "Mint a bearer key in the console, then everything else is HTTP. No dashboards to click through mid-run.",
  },
  {
    icon: Gauge,
    title: "Credit metering per call",
    body: "Every tool has a published credit price. Balance runs out and you get a clean 402, not a silent failure.",
  },
  {
    icon: ShieldCheck,
    title: "Side effects are opt-in",
    body: "Email, CRM writes, payments and deletes return 428 with a preview and a single-use token bound to those exact arguments. No token, no execution.",
  },
  {
    icon: Plug,
    title: "MCP built in",
    body: "The same catalog is served over Model Context Protocol with OAuth 2.1 for Claude, Cursor and ChatGPT.",
  },
  {
    icon: Terminal,
    title: "Typed contracts",
    body: "Every tool ships JSON Schema arguments and results, published as an OpenAPI 3.1 document and agent manifest.",
  },
  {
    icon: Receipt,
    title: "Auditable by tenant",
    body: "Keys, usage events, credit ledger and audit logs are isolated per workspace at the database level.",
  },
];

function Landing() {
  return (
    <PublicShell>
      <main>
        <section className="mx-auto max-w-3xl px-6 pt-20 pb-12 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.35em] text-muted-foreground">
            Tool API for autonomous agents
          </p>
          <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl">
            Agents onboard themselves here.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
            {SITE_NAME} is a pay-per-call tool API designed to be consumed by software, not people.
            One unauthenticated POST mints a key and 500 free credits — no browser, no password, no
            email verification loop. Discover tools over OpenAPI or MCP, pay in credits, and keep
            destructive actions behind an explicit confirmation.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button size="lg" asChild>
              <Link to="/docs">Read the docs</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link to="/auth">Human console</Link>
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            500 free credits per workspace. No card required to start. Machine-readable onboarding at{" "}
            <a className="underline underline-offset-4" href="/llms.txt">
              /llms.txt
            </a>
            .
          </p>

        </section>

        <section className="mx-auto max-w-3xl px-6 pb-16">
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-5 text-left font-mono text-xs leading-relaxed text-foreground">
            {QUICKSTART}
          </pre>
        </section>

        <section className="mx-auto max-w-5xl px-6 pb-16">
          <h2 className="text-center text-2xl font-semibold tracking-tight text-foreground">
            How it works
          </h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="rounded-lg border border-border bg-card p-5">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
                  Step {i + 1}
                </span>
                <h3 className="mt-2 text-sm font-semibold text-card-foreground">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                <code className="mt-3 block overflow-x-auto whitespace-pre rounded bg-muted/50 px-2 py-1 font-mono text-[11px] text-foreground">
                  {step.code}
                </code>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto max-w-3xl px-6 pb-16">
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="text-xl font-semibold text-card-foreground">
              Already using ChatGPT, Claude or Cursor?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              The same catalog is served over Model Context Protocol. Add one remote server URL and
              your assistant can call every RELAY tool — with the same credit metering and
              confirmation gates.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button asChild>
                <Link to="/connect">Connect your assistant</Link>
              </Button>
              <Button variant="outline" asChild>
                <a href="/llms.txt">Agent-readable overview</a>
              </Button>
            </div>
          </div>
        </section>


        <section className="mx-auto max-w-5xl px-6 pb-20">
          <h2 className="text-center text-2xl font-semibold tracking-tight text-foreground">
            Built for callers with no hands
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-lg border border-border bg-card p-5 text-left">
                <Icon className="size-5 text-primary" aria-hidden />
                <h3 className="mt-3 text-sm font-semibold text-card-foreground">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-6 pb-20">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Starter tool catalog</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Prices are per successful call. Side-effecting tools are marked and gated. Live tools
            do real work and cost credits; every{" "}
            <span className="font-mono">sandbox_*</span> tool is free and returns fixture data, so
            agents can rehearse the full flow before spending anything.
          </p>
          <ul className="mt-5 divide-y divide-border rounded-lg border border-border">
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
        </section>

        <section className="mx-auto max-w-3xl px-6 pb-24">
          <div className="rounded-lg border border-border bg-card p-6 text-center">
            <h2 className="text-xl font-semibold text-card-foreground">
              Credits from {formatUsd(CREDIT_PACKS[0]!.amountCents)}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              One-time packs, no subscription, credits do not expire. Orders are handled by Paddle
              as Merchant of Record.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <Button asChild>
                <Link to="/pricing">See pricing</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/auth">Create a workspace</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
    </PublicShell>
  );
}

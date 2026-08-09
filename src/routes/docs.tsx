import { createFileRoute, Link } from "@tanstack/react-router";

import { PUBLIC_TOOLS } from "@/lib/agent/contracts";
import { CREDIT_PACKS, formatUsd } from "@/lib/billing/packs";
import { LegalFooter } from "@/components/LegalFooter";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "Agent Tool API docs — pay-per-call tools for AI agents" },
      {
        name: "description",
        content:
          "Machine-first REST API for autonomous agents: bearer key auth, credit metering, OpenAPI discovery and explicit side-effect confirmation.",
      },
      { property: "og:title", content: "Agent Tool API docs" },
      {
        property: "og:description",
        content: "Bearer-key auth, credit metering and OpenAPI discovery for autonomous agents.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DocsPage,
});

function DocsPage() {
  return (
    <>
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <span className="font-mono text-[11px] tracking-[0.3em] text-primary">RELAY</span>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
        Agent Tool API
      </h1>
      <p className="mt-3 text-muted-foreground">
        A metered HTTP API built for autonomous agents. Sign up, mint a key, and start calling
        tools — no human in the loop except for side-effecting actions, which require an explicit
        per-call confirmation header.
      </p>

      <div className="mt-6 flex gap-3">
        <Button asChild>
          <Link to="/keys">Get an API key</Link>
        </Button>
        <Button variant="outline" asChild>
          <a href="/api/public/v1/openapi.json">OpenAPI spec</a>
        </Button>
      </div>

      <Section title="Discovery">
        <Code>{`GET /api/public/v1/tools          # catalog with JSON Schemas + prices
GET /api/public/v1/openapi.json   # OpenAPI 3.1 document
GET /.well-known/agent-manifest.json`}</Code>
      </Section>

      <Section title="Authentication">
        <p className="mb-3 text-sm text-muted-foreground">
          Every request carries a workspace key as a bearer token. New workspaces start with 500
          free credits.
        </p>
        <Code>{`Authorization: Bearer sk_agent_xxxxxxxx_...`}</Code>
      </Section>

      <Section title="Invoke a tool">
        <Code>{`curl -X POST https://your-domain/api/public/v1/tools/search_knowledge_base \\
  -H "Authorization: Bearer $RELAY_KEY" \\
  -H "content-type: application/json" \\
  -d '{"query":"refund policy"}'`}</Code>
        <p className="mt-3 text-sm text-muted-foreground">
          Side-effecting tools return <Mono>428 confirmation_required</Mono> unless you add{" "}
          <Mono>x-confirm-side-effects: true</Mono>. Out of credits returns{" "}
          <Mono>402 insufficient_credits</Mono>; over 60 calls/min returns{" "}
          <Mono>429 rate_limited</Mono>.
        </p>
      </Section>

      <Section title="Catalog & pricing">
        <ul className="divide-y divide-border rounded-lg border border-border">
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
        <p className="mt-3 text-xs text-muted-foreground">
          Launch tools return simulated fixtures; every response includes{" "}
          <Mono>&quot;demo&quot;: true</Mono> until the underlying integration is live.
        </p>
        <h3 className="mt-6 text-sm font-medium text-foreground">What credits cost</h3>
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
          {CREDIT_PACKS.map((pack) => (
            <li key={pack.priceId} className="flex items-center justify-between gap-4 px-4 py-3">
              <span className="text-sm text-foreground">
                {pack.label} — {pack.credits.toLocaleString()} credits
              </span>
              <span className="shrink-0 text-sm font-semibold text-foreground">
                {formatUsd(pack.amountCents)}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          One-time purchases in USD, excluding tax. New workspaces start with 500 free credits. See{" "}
          <Link to="/pricing" className="underline">
            full pricing
          </Link>
          .
        </p>
      </Section>


      <Section title="MCP server">
        <p className="mb-3 text-sm text-muted-foreground">
          The same catalog is exposed over Model Context Protocol for clients like Claude, Cursor
          and ChatGPT. Connect with OAuth — you approve the client once, then calls are metered
          against your workspace credits.
        </p>
        <Code>{`https://your-domain/mcp   # Streamable HTTP, OAuth 2.1 (dynamic client registration)`}</Code>
      </Section>

      <Section title="Account status">
        <Code>{`GET /api/public/v1/me
{ "ok": true, "credits": { "balance": 500 }, "rateLimit": { "perMinute": 60 } }`}</Code>
      </Section>

    </main>
  );
}


function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="mb-3 text-lg font-medium text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-4 font-mono text-xs text-foreground">
      {children}
    </pre>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>;
}

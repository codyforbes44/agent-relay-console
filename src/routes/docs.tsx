import { createFileRoute, Link } from "@tanstack/react-router";

import { PublicShell } from "@/components/public/PublicShell";
import { Button } from "@/components/ui/button";
import { PUBLIC_TOOLS } from "@/lib/agent/contracts";
import { CREDIT_PACKS, formatUsd } from "@/lib/billing/packs";
import { SITE_URL, publicHead } from "@/lib/site";

export const Route = createFileRoute("/docs")({
  head: () =>
    publicHead({
      path: "/docs",
      title: "API docs — Agent Relay Console tool API for agents",
      description:
        "Machine-first REST and MCP API for autonomous agents: bearer key auth, credit metering, OpenAPI discovery, idempotency keys and explicit side-effect confirmation.",
    }),
  component: DocsPage,
});

function DocsPage() {
  return (
    <PublicShell>
      <main className="mx-auto w-full max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Agent Tool API</h1>
        <p className="mt-3 text-muted-foreground">
          A metered HTTP API built for autonomous agents. Mint a key, discover the catalog, call
          tools. No human in the loop except for side-effecting actions, which require an explicit
          per-call confirmation header.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild>
            <Link to="/keys">Get an API key</Link>
          </Button>
          <Button variant="outline" asChild>
            <a href="/api/public/v1/openapi.json">OpenAPI 3.1 spec</a>
          </Button>
          <Button variant="ghost" asChild>
            <a href="/.well-known/agent-manifest.json">Agent manifest</a>
          </Button>
        </div>

        <Section title="Base URL">
          <Code>{`${SITE_URL}/api/public/v1`}</Code>
        </Section>

        <Section title="1. Discovery">
          <p className="mb-3 text-sm text-muted-foreground">
            Three machine-readable entry points. All are unauthenticated so an agent can plan before
            it has a key.
          </p>
          <Code>{`GET /api/public/v1/tools          # catalog with JSON Schemas + credit prices
GET /api/public/v1/openapi.json   # OpenAPI 3.1 document
GET /.well-known/agent-manifest.json`}</Code>
        </Section>

        <Section title="2. Authentication">
          <p className="mb-3 text-sm text-muted-foreground">
            Every call carries a workspace key as a bearer token. Keys are shown once at creation
            and stored hashed; revoke them any time from the console. Invoking tools requires the{" "}
            <Mono>tools:invoke</Mono> scope. New workspaces start with 500 free credits.
          </p>
          <Code>{`Authorization: Bearer sk_agent_xxxxxxxx_...`}</Code>
        </Section>

        <Section title="3. Invoke a tool">
          <Code>{`curl -X POST ${SITE_URL}/api/public/v1/tools/search_knowledge_base \\
  -H "Authorization: Bearer $RELAY_KEY" \\
  -H "content-type: application/json" \\
  -H "idempotency-key: 9f1c-run-42" \\
  -d '{"query":"refund policy"}'`}</Code>
          <p className="mt-3 text-sm text-muted-foreground">
            Arguments are validated against the tool&apos;s JSON Schema. Invalid input returns{" "}
            <Mono>422 invalid_input</Mono> with the failing field paths, and no credits are charged.
            A successful call responds with:
          </p>
          <Code>{`{
  "ok": true,
  "requestId": "b0e1…",
  "tool": "search_knowledge_base",
  "demo": true,
  "credits": { "charged": 1, "balance": 499 },
  "result": { … }
}`}</Code>
          <p className="mt-3 text-sm text-muted-foreground">
            Responses also carry <Mono>x-request-id</Mono> and <Mono>x-credits-charged</Mono>{" "}
            headers. Fetch a single tool&apos;s schema without a key with{" "}
            <Mono>GET /api/public/v1/tools/{"{name}"}</Mono>. CORS is open, so browser-based agents
            can call the API directly.
          </p>
        </Section>

        <Section title="4. Side effects require confirmation">
          <p className="mb-3 text-sm text-muted-foreground">
            Tools that send email, write to a CRM, create payments or delete records return{" "}
            <Mono>428 confirmation_required</Mono> with a preview of the exact arguments that would
            run and the credit cost. Repeat the call with the confirmation header to execute it. The
            rejected attempt is logged in your usage history and charges nothing.
          </p>
          <Code>{`-H "x-confirm-side-effects: true"`}</Code>
        </Section>

        <Section title="5. Idempotency">
          <p className="mb-3 text-sm text-muted-foreground">
            Send an <Mono>idempotency-key</Mono> header on any call. The key is scoped to your API
            key. Repeating a completed call with the same key returns the original stored response
            with <Mono>&quot;replayed&quot;: true</Mono> and is not charged again — safe for agent
            retry loops and timeouts. If the first call is still running, the retry gets{" "}
            <Mono>409 request_in_progress</Mono>; failed calls release the key so you can retry.
          </p>
        </Section>

        <Section title="6. Rate limits">
          <p className="mb-3 text-sm text-muted-foreground">
            60 calls per minute per API key, counted over a rolling window. Over the limit you get{" "}
            <Mono>429 rate_limited</Mono>. Mint additional keys for parallel workers.
          </p>
        </Section>

        <Section title="7. Errors">
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {[
              ["401 missing_api_key", "No Authorization: Bearer header on the request."],
              ["401 invalid_api_key", "Key is unknown, revoked or expired."],
              ["403 insufficient_scope", "Key lacks the tools:invoke scope."],
              ["404 unknown_tool", "No tool with that name in the catalog."],
              ["409 request_in_progress", "Same idempotency-key is still executing."],
              ["422 invalid_json", "Body was not valid JSON."],
              ["422 invalid_input", "Arguments failed schema validation. Not charged."],
              ["402 insufficient_credits", "Balance below this tool's price. Includes required + balance."],
              ["428 confirmation_required", "Side-effecting tool called without confirmation."],
              ["429 rate_limited", "Over 60 calls per minute for this key. Back off and retry."],
              ["502 tool_failed", "Upstream tool execution failed. Credits are not deducted."],
            ].map(([code, body]) => (
              <li key={code} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:gap-4">
                <span className="w-56 shrink-0 font-mono text-xs text-primary">{code}</span>
                <span className="text-xs text-muted-foreground">{body}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted-foreground">
            Every error body has the same shape, sometimes with extra context fields:
          </p>
          <Code>{`{ "ok": false, "error": { "code": "insufficient_credits", "message": "...", "required": 5, "balance": 2 } }`}</Code>
        </Section>

        <Section title="8. Catalog & credit prices">

          <ul className="divide-y divide-border rounded-lg border border-border">
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
            One-time purchases in USD, excluding tax. See{" "}
            <Link to="/pricing" className="underline">
              full pricing
            </Link>
            .
          </p>
        </Section>

        <Section title="9. MCP server">
          <p className="mb-3 text-sm text-muted-foreground">
            The same catalog is exposed over Model Context Protocol for clients like Claude, Cursor
            and ChatGPT. Connect with OAuth 2.1 — you approve the client once, then calls are
            metered against your workspace credits exactly like HTTP calls. Side-effecting tools
            take a <Mono>confirm</Mono> argument instead of the HTTP header.
          </p>
          <Code>{`${SITE_URL}/mcp   # Streamable HTTP, OAuth 2.1 (dynamic client registration)`}</Code>
        </Section>

        <Section title="10. Account status">
          <Code>{`GET /api/public/v1/me
{
  "ok": true,
  "orgId": "…",
  "scopes": ["tools:invoke"],
  "credits": { "balance": 500 },
  "usage": { "totalCalls": 12 },
  "rateLimit": { "perMinute": 60 }
}`}</Code>
          <p className="mt-3 text-sm text-muted-foreground">
            Poll this before a long run, or read the balance from the console&apos;s{" "}
            <Link to="/usage" className="underline">
              usage page
            </Link>
            .
          </p>
        </Section>

      </main>
    </PublicShell>
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

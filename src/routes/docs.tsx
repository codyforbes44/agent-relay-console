import { createFileRoute, Link } from "@tanstack/react-router";

import { PublicShell } from "@/components/public/PublicShell";
import { TryToolPanel } from "@/components/public/TryToolPanel";
import { Button } from "@/components/ui/button";
import { PUBLIC_TOOLS, exampleSuccessEnvelope } from "@/lib/agent/contracts";
import { API_ERRORS, ERROR_ENVELOPE_EXAMPLE } from "@/lib/api/errors";
import { CREDIT_PACKS, formatUsd } from "@/lib/billing/packs";
import { SITE_URL, publicHead } from "@/lib/site";

export const Route = createFileRoute("/docs")({
  head: () =>
    publicHead({
      path: "/docs",
      title: "API docs — RELAY tool API for agents",
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

        <Section title="Quickstart in four calls">
          <p className="mb-3 text-sm text-muted-foreground">
            The whole loop, copy-pasteable. Every step below is documented in detail further down
            this page.
          </p>
          <Code>{`# 1. mint a key + 500 free credits (no auth)
curl -X POST ${SITE_URL}/api/public/v1/signup -H "content-type: application/json" -d '{"label":"my agent"}'

# 2. discover the catalog (typed JSON Schema per tool)
curl ${SITE_URL}/api/public/v1/tools

# 3. call a live read-only tool (2 credits)
curl -X POST ${SITE_URL}/api/public/v1/tools/fetch_url \\
  -H "Authorization: Bearer $RELAY_KEY" -H "content-type: application/json" \\
  -d '{"url":"https://example.com"}'

# 4a. call a side-effecting tool — returns 428 with a preview + confirmationToken
curl -X POST ${SITE_URL}/api/public/v1/tools/sandbox_send_email \\
  -H "Authorization: Bearer $RELAY_KEY" -H "content-type: application/json" \\
  -d '{"to":"ops@example.com","subject":"hi","body":"hello"}'

# 4b. human approves the preview, then resend the IDENTICAL body with the token
curl -X POST ${SITE_URL}/api/public/v1/tools/sandbox_send_email \\
  -H "Authorization: Bearer $RELAY_KEY" -H "content-type: application/json" \\
  -H "x-confirmation-token: $CONFIRMATION_TOKEN" -H "idempotency-key: $(uuidgen)" \\
  -d '{"to":"ops@example.com","subject":"hi","body":"hello"}'`}</Code>
        </Section>

        <Section title="0. Agents sign themselves up">
          <p className="mb-3 text-sm text-muted-foreground">
            No browser, no password, no email verification loop. One unauthenticated POST creates a
            workspace, returns an API key (shown once) and grants 500 free credits.
          </p>
          <Code>{`curl -X POST ${SITE_URL}/api/public/v1/signup \\
  -H "content-type: application/json" \\
  -d '{"label":"my agent"}'`}</Code>
          <Code>{`{
  "ok": true,
  "orgId": "…",
  "apiKey": "sk_agent_xxxxxxxx_…",
  "credits": { "granted": 500, "balance": 500 },
  "claim": { "url": "${SITE_URL}/claim?token=…", "expiresAt": "…" }
}`}</Code>
          <p className="mt-3 text-sm text-muted-foreground">
            Signup is limited to 3 workspaces per address per 24h (
            <Mono>429 signup_rate_limited</Mono>). When credits run out, call{" "}
            <Mono>POST /api/public/v1/claim</Mono> for a fresh one-hour claim URL and hand it to
            your human operator: they sign in, take ownership of the workspace and buy credits. The
            agent&apos;s key keeps working throughout. Rotate a key with{" "}
            <Mono>POST /api/public/v1/keys/rotate</Mono> — the old key stays valid for 10 more
            minutes. Machine-readable version of this page: <Mono>{`${SITE_URL}/llms.txt`}</Mono>.
          </p>
        </Section>

        <Section title="0b. Agents pay for themselves (x402)">
          <p className="mb-3 text-sm text-muted-foreground">
            When the balance runs out, the <Mono>402</Mono> is machine-payable. The body follows the{" "}
            <a className="underline" href="https://x402.org" target="_blank" rel="noreferrer">
              x402
            </a>{" "}
            spec: settle <Mono>accepts[0]</Mono> in USDC on Base, then retry the same request with
            an <Mono>X-PAYMENT</Mono> header. Credits are added and the call executes in that one
            retry.
          </p>
          <Code>{`{
  "x402Version": 1,
  "error": "insufficient_credits",
  "accepts": [{
    "scheme": "exact",
    "network": "base",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "maxAmountRequired": "900000",
    "payTo": "0x…",
    "resource": "${SITE_URL}/api/public/v1/tools/crm.update_contact",
    "maxTimeoutSeconds": 120
  }],
  "payment": { "credits": 100, "amountUsd": 0.9, "asset": "USDC", "network": "base" }
}`}</Code>
          <p className="mt-3 text-sm text-muted-foreground">
            To top up ahead of time instead of on the failing call:
          </p>
          <Code>{`curl -X POST ${SITE_URL}/api/public/v1/credits/purchase \\
  -H "Authorization: Bearer $RELAY_KEY" \\
  -H "content-type: application/json" \\
  -d '{"credits":1000}'          # → 402 with the offer, then retry with X-PAYMENT`}</Code>
          <p className="mt-3 text-sm text-muted-foreground">
            Payments are credited once per settled transaction, so a replayed <Mono>X-PAYMENT</Mono>{" "}
            never double-charges. If on-chain payment is not available to you, fall back to{" "}
            <Mono>POST /api/public/v1/claim</Mono> and a human buys credits with a card.
          </p>
        </Section>

        <Section title="0c. Spend guardrails">
          <p className="mb-3 text-sm text-muted-foreground">
            Every key can carry owner-set limits, enforced server-side before a tool runs: max
            credits per call, a rolling 24-hour cap, a lifetime cap, an expiry date and a tool
            allowlist. Exceeding one returns <Mono>403 budget_exceeded</Mono>,{" "}
            <Mono>403 tool_not_allowed</Mono> or <Mono>401 key_expired</Mono> with the limit and
            spend-to-date in the body — nothing is executed or charged. Configure them per key in
            the console.
          </p>
        </Section>

        <Section title="1. Discovery">
          <p className="mb-3 text-sm text-muted-foreground">
            Machine-readable entry points. All are unauthenticated so an agent can plan — and price
            the job — before it has a key.
          </p>
          <Code>{`GET /api/public/v1/tools             # catalog: JSON Schemas, credits and usdPerCall
GET /api/public/v1/pricing           # USD per credit, per tool and per pack
GET /api/public/v1/openapi.json      # OpenAPI 3.1 document
GET /.well-known/agents.json         # agent-native discovery document
GET /.well-known/ai-plugin.json      # OpenAI-style plugin manifest
GET /.well-known/agent-manifest.json # legacy alias of agents.json`}</Code>
        </Section>

        <Section title="2. Authentication">
          <p className="mb-3 text-sm text-muted-foreground">
            Every call carries a workspace key as a bearer token. Keys are shown once at creation
            and stored hashed; revoke them any time from the console. Invoking tools requires the{" "}
            <Mono>tools:invoke</Mono> scope. New workspaces start with 500 free credits.
          </p>
          <Code>{`Authorization: Bearer sk_agent_xxxxxxxx_...
# fallback for clients that cannot set Authorization:
x-api-key: sk_agent_xxxxxxxx_...`}</Code>
        </Section>

        <Section title="3. Invoke a tool">
          <Code>{`curl -X POST ${SITE_URL}/api/public/v1/tools/fetch_url \\
  -H "Authorization: Bearer $RELAY_KEY" \\
  -H "content-type: application/json" \\
  -H "idempotency-key: 9f1c-run-42" \\
  -d '{"url":"https://example.com"}'`}</Code>
          <p className="mt-3 text-sm text-muted-foreground">
            Arguments are validated against the tool&apos;s JSON Schema. Invalid input returns{" "}
            <Mono>422 invalid_input</Mono> with the failing field paths, and no credits are charged.
            A successful call responds with:
          </p>
          <Code>{`{
  "ok": true,
  "requestId": "b0e1…",
  "tool": "fetch_url",
  "demo": false,
  "credits": { "charged": 2, "balance": 498 },
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
            run, the credit cost, and a single-use <Mono>confirmationToken</Mono>. Show the preview
            to your operator; once they approve, resend the identical body with the token to
            execute. The rejected attempt is logged in your usage history and charges nothing.
          </p>
          <Code>{`-H "x-confirmation-token: $CONFIRMATION_TOKEN"`}</Code>
          <p className="mt-3 text-sm text-muted-foreground">
            The token is bound to the exact arguments that were previewed, is valid for 10 minutes
            and can be redeemed once. Changing any field returns{" "}
            <Mono>409 confirmation_mismatch</Mono>; reusing a token returns{" "}
            <Mono>409 confirmation_used</Mono>; letting it lapse returns{" "}
            <Mono>410 confirmation_expired</Mono>. There is no header an agent can set on its first
            call to skip the preview — that is the point.
          </p>
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

        <Section title="7. Error code reference">
          <p className="mb-3 text-sm text-muted-foreground">
            Every failure uses the same envelope:{" "}
            <Mono>{`{ "ok": false, "error": { "code", "message", … } }`}</Mono>. This table is the
            single reference for the whole API — the OpenAPI document is generated from it.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Code</th>
                  <th className="px-3 py-2 font-medium">Cause</th>
                  <th className="px-3 py-2 font-medium">What to do</th>
                  <th className="px-3 py-2 font-medium">Retry</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {API_ERRORS.map((e) => (
                  <tr key={e.code} className="align-top">
                    <td className="px-3 py-2 font-mono text-primary">{e.status}</td>
                    <td className="px-3 py-2 font-mono text-foreground">
                      {e.code}
                      {e.extra?.length ? (
                        <span className="block text-[10px] text-muted-foreground">
                          + {e.extra.join(", ")}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{e.cause}</td>
                    <td className="px-3 py-2 text-muted-foreground">{e.action}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {e.retryable ? "yes" : "no"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Code>{JSON.stringify(ERROR_ENVELOPE_EXAMPLE)}</Code>
        </Section>

        <Section title="8. Try a tool">
          <p className="mb-3 text-sm text-muted-foreground">
            Pick a tool, edit the example body, and send it live from your browser. Leave the key
            blank to see the real <Mono>401</Mono>, or flip the confirmation switch off on a
            side-effecting tool to see the <Mono>428</Mono> preview payload.
          </p>
          <TryToolPanel />
        </Section>

        <Section title="9. Starter catalog, examples & credit prices">
          <p className="mb-3 text-sm text-muted-foreground">
            The catalog has two tiers. Live tools (<Mono>fetch_url</Mono>, <Mono>crawl_site</Mono>,{" "}
            <Mono>extract_structured</Mono>, <Mono>search_web</Mono>,{" "}
            <Mono>search_knowledge_base</Mono>, <Mono>execute_code</Mono>, <Mono>browse_page</Mono>)
            do real network, model, vector search, code execution and remote browser work, cost
            credits and return <Mono>&quot;demo&quot;: false</Mono>.{" "}
            <Mono>search_knowledge_base</Mono> runs semantic search over documents uploaded to the
            workspace knowledge base. <Mono>execute_code</Mono> runs Python or JavaScript in an
            isolated E2B sandbox. <Mono>browse_page</Mono> renders a URL in a Browserbase cloud
            browser and returns the markdown text. Every <Mono>sandbox_*</Mono> tool is free (0
            credits), returns fixture data with <Mono>&quot;demo&quot;: true</Mono> and changes
            nothing — use them to rehearse auth, schemas, idempotency and the confirmation gate.
            Workspace owners can disable any tool in the console.
          </p>
          <div className="space-y-4">
            {PUBLIC_TOOLS.map((t) => (
              <details key={t.name} className="rounded-lg border border-border px-4 py-3">
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3">
                  <span className="font-mono text-sm text-foreground">
                    {t.name}
                    {t.sideEffecting ? (
                      <span className="ml-2 rounded-full border border-border px-2 py-0.5 font-sans text-[10px] uppercase tracking-wide text-muted-foreground">
                        confirm
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary">
                    {t.credits} cr
                  </span>
                </summary>
                <p className="mt-2 text-xs text-muted-foreground">{t.description}</p>
                <p className="mt-3 text-xs font-medium text-foreground">Request</p>
                <Code>{`curl -X POST ${SITE_URL}/api/public/v1/tools/${t.name} \\
  -H "Authorization: Bearer $RELAY_KEY" \\
  -H "content-type: application/json" \\
  -H "idempotency-key: run-42" \\${
    t.sideEffecting ? `\n  -H "x-confirmation-token: $CONFIRMATION_TOKEN" \\` : ""
  }
  -d '${JSON.stringify(t.example)}'`}</Code>
                <p className="mt-3 text-xs font-medium text-foreground">Response — 200</p>
                <Code>{JSON.stringify(exampleSuccessEnvelope(t), null, 2)}</Code>
                <p className="mt-3 text-xs text-muted-foreground">
                  Replaying the same <Mono>idempotency-key</Mono> returns this exact body with{" "}
                  <Mono>&quot;replayed&quot;: true</Mono> and charges nothing.
                  {t.sideEffecting
                    ? " Call it first without a token: the 428 response carries a preview of these arguments plus the single-use confirmationToken used above."
                    : ""}
                </p>
                <p className="mt-3 text-xs font-medium text-foreground">MCP</p>
                <Code>{`tools/call → ${t.name}
arguments: ${JSON.stringify(t.example)}
structuredContent: ${JSON.stringify({
                  ...t.exampleResult,
                  demo: t.demo,
                  credits: { charged: t.credits, balance: 500 - t.credits },
                })}`}</Code>
              </details>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            <Mono>sandbox_*</Mono> tools are free and return fixtures with{" "}
            <Mono>&quot;demo&quot;: true</Mono>. Their pre-rename names (e.g.{" "}
            <Mono>send_email</Mono>) still resolve for now and answer with a <Mono>deprecated</Mono>{" "}
            pointer to the new name.
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

        <Section title="10. Security best practices for operators">
          <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              Issue a dedicated API key for each MCP client or autonomous agent. Narrow the{" "}
              <Mono>allowedTools</Mono> list to only the tools that agent needs, and set a per-key
              daily or lifetime credit cap.
            </li>
            <li>
              Disable any tool you do not expect your agents to use from the console{" "}
              <Mono>/tools</Mono> page. Workspace-level disables apply across every key and MCP
              connection.
            </li>
            <li>
              Side-effecting tools (sandbox_send_email, sandbox_update_crm_record,
              sandbox_create_payment, sandbox_delete_record) always take two calls: an unconfirmed
              call that returns a preview and a single-use token, then the confirmed call. Because
              the token is issued by the server and bound to the previewed arguments, an agent
              cannot authorize itself in advance.
            </li>
            <li>
              Rotate keys regularly. The rotation endpoint keeps the old key valid for 10 minutes,
              so you can update your agents without downtime.
            </li>
            <li>
              Monitor the <Mono>audit_logs</Mono> table and usage page for unexpected tool names or
              credit spend spikes.
            </li>
          </ul>
        </Section>

        <Section title="11. MCP server">
          <p className="mb-3 text-sm text-muted-foreground">
            The same catalog is exposed over Model Context Protocol for clients like Claude, Cursor
            and ChatGPT. Connect with OAuth 2.1 — you approve the client once, then calls are
            metered against your workspace credits exactly like HTTP calls. Side-effecting tools are
            marked with the MCP <Mono>destructiveHint</Mono> annotation, so compliant clients ask
            the human to approve the call before it runs.
          </p>
          <Code>{`${SITE_URL}/mcp   # Streamable HTTP, OAuth 2.1 (dynamic client registration)`}</Code>
          <p className="mt-3 text-sm text-muted-foreground">
            Differences from the HTTP API: each tool description carries its credit cost, results
            come back as JSON text plus <Mono>structuredContent</Mono> with the same{" "}
            <Mono>demo</Mono> and <Mono>credits</Mono> fields, and failures (including an exhausted
            balance) surface as an MCP tool error rather than an HTTP status code. The{" "}
            <Mono>idempotency-key</Mono> header is HTTP-only. Confirmation is not: over MCP the same
            gate is expressed as a <Mono>confirmation_token</Mono> argument — the first call returns
            the preview and token as a tool error, the second call carries the token. Usage from MCP
            appears in the same console usage history.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            <strong>Tool visibility note:</strong> The MCP list-tools endpoint may show the full
            starter catalog even when a workspace has disabled a tool. Workspace-level disables and
            per-key <Mono>allowedTools</Mono> are enforced at invocation time, so a disabled or
            disallowed tool returns a clear <Mono>tool_disabled</Mono> error instead of running.
          </p>
        </Section>

        <Section title="12. Account status">
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

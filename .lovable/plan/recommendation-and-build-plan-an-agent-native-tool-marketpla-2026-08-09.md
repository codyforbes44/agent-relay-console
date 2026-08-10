# Recommendation and build plan: an agent-native tool marketplace

## The call

Given: the end customer is an AI agent, you want self-serve revenue, and your edge is dev/API/agentic tooling plus distribution across online channels — the optimal play is **a horizontal but narrow wedge: a paid, metered tool/service API that agents can discover and call without a human ever signing up manually.**

Not a generic "agent orchestration platform" (crowded, captured by model vendors), and not a human-facing vertical SaaS (your buyer isn't human). The wedge is the **monetization + access layer for agent-callable services**: keys, metering, billing, discovery, audit. You already have the hard parts — auth, tenancy, RLS, typed tool contracts, tool execution, audit logs.

Revenue model: usage-based credits (prepaid packs + overage). Agents don't sign annual contracts; they burn credits. Take-rate on third-party listed tools comes later, once first-party tools show demand.

Fastest path to first dollar: **publish 2–3 genuinely useful tools that agents already want and pay per call**, make them reachable over MCP and plain HTTP, and market them through the channels you already own.

## Phase 1 — turn this workspace into an agent-callable product

### 1. Machine-first access (no human login required)

- API keys issued per organization: `agent_keys` table storing a hash, prefix, label, scopes, revoked flag, last-used timestamp. Plaintext key shown once at creation.
- Public HTTP surface at `src/routes/api/public/v1/*`: `POST /tools/:name` (invoke), `GET /tools` (catalog), `GET /me` (balance + limits). Authenticated by `Authorization: Bearer sk_...`, not a Supabase session.
- Existing `/api/agent` stays as the human console; the public API reuses the same typed contracts in `src/lib/agent/contracts.ts` and handlers in `tools.server.ts`, so there is one implementation.
- Machine-readable discovery: OpenAPI JSON at `/api/public/v1/openapi.json` and `/.well-known/ai-plugin.json`-style manifest, so an agent can self-onboard from the URL alone.

### 2. MCP server

- Expose the same tool catalog as an MCP server so Claude/ChatGPT/Cursor users can attach it in one click. This is the single highest-leverage distribution channel for an agent-native product.
- Auth via OAuth so each caller acts as their own tenant.

### 3. Metering and credits

- `usage_events` (org, key, tool, credits, latency, status, request id) written on every call; `credit_ledger` for grants, purchases and deductions; balance is a derived view.
- Per-tool credit price in the contract. Pre-flight balance check, post-flight deduction, `402` with a machine-readable body when out of credits (agents need to parse the failure, not read a modal).
- Rate limits per key on top of the existing per-user limiter.

### 4. Self-serve payments

- Prepaid credit packs plus auto top-up. Checkout is human-initiated once (the operator behind the agent), then the agent runs unattended.
- Provider selected via the payments eligibility check before wiring anything.

### 5. Human console additions (thin, but required for conversion)

- Keys page: create, label, copy-once, revoke.
- Usage dashboard: calls, credits burned, spend by tool, recent errors.
- Billing page: balance, packs, auto top-up toggle, invoice history.
- Public docs page with copy-paste curl, TypeScript, and MCP config snippets — this page is the top of the funnel, so it must render server-side and be indexable.

### 6. Which tools to launch with

Pick tools where the value is real work, not a thin model wrapper, and where per-call pricing is obvious. Candidates worth choosing 2–3 from: structured web extraction, document parsing to schema, enrichment/lookup, scheduled/deferred execution, verified send actions. The current simulated CRM/email/payment tools stay as demo fixtures and are clearly labelled as such.

### 7. Distribution (your stated edge)

- Ship the MCP listing, a public catalog page per tool (own the long-tail queries agents' operators search), and an OpenAPI spec that aggregators can ingest.
- Free credit grant on signup so an agent can complete a real call before any payment step.

## Explicitly out of scope for now

Third-party tool listings and take-rate, agent-to-agent escrow, and multi-agent orchestration. Those only make sense after first-party tools prove demand; building the marketplace before the supply or demand exists is the standard way this category dies.

## Technical notes

- Public routes live under `src/routes/api/public/v1/` so they bypass site auth; every handler verifies the bearer API key itself, validates input with Zod against the existing tool schemas, and returns typed JSON errors (`401`, `402`, `422`, `429`) with stable machine-readable `code` fields.
- API keys are stored as SHA-256 hashes with a searchable prefix; lookup is by prefix then constant-time compare.
- Key-authenticated requests resolve an org and then use the service-role client for the metered write path (there is no user JWT), with the org id enforced in code; human console reads keep going through RLS as today.
- New tables (`agent_keys`, `usage_events`, `credit_ledger`, `credit_packs`) get GRANTs plus `has_org_access`-based RLS for console reads; writes from the public path go through the privileged path only.
- Tool credit cost and public/private visibility become fields on `ToolContract`, keeping one source of truth for the console, the OpenAPI spec, and the MCP catalog.
- Structured logs per call: request id, org, key prefix, tool, credits, duration, outcome — reused for the usage dashboard rather than a separate analytics store.

## Suggested build order

1. Keys + public invoke endpoint + OpenAPI/manifest (first real agent call).
2. Metering, credits, `402` handling, per-key rate limits.
3. MCP server over the same catalog.
4. Payments and auto top-up.
5. Console pages: keys, usage, billing, docs.
6. Replace demo tools with the 2–3 launch tools.

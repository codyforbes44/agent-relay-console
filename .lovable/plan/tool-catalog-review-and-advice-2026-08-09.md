# Tool catalog review and advice

## What the catalog looks like today

Eight public tools. One is real, seven are simulated fixtures:

| Tool                  | Credits | USD/call | Real? | Verdict                                              |
| --------------------- | ------- | -------- | ----- | ---------------------------------------------------- |
| fetch_url             | 2       | $0.02    | yes   | Keep. This is the only thing an agent can buy today. |
| search_knowledge_base | 1       | $0.01    | no    | Fake. Searches three hardcoded strings.              |
| lookup_crm_contact    | 1       | $0.01    | no    | Fake. Three hardcoded contacts.                      |
| list_records          | 1       | $0.01    | no    | Fake. Same fixtures.                                 |
| send_email            | 5       | $0.05    | no    | Fake. Charges $0.05 to send nothing.                 |
| update_crm_record     | 3       | $0.03    | no    | Fake.                                                |
| create_payment        | 10      | $0.09    | no    | Fake. Charges real credits to simulate a charge.     |
| delete_record         | 3       | $0.03    | no    | Fake.                                                |

The honest read: the discovery, metering, confirmation-token and x402 rails are
production-grade, but the thing being sold is mostly a demo. An agent that finds
Relay, spends its free 500 credits and gets `"demo": true` on every response will
not top up. Charging credits for simulated side effects is also the single
biggest refund and trust risk on the platform.

## Advice

1. **Stop charging for simulations.** Rename the seven fixtures to a `sandbox_`
   namespace, price them at 0 credits, and keep them for integration testing of
   the confirmation and idempotency flows. That is a genuinely useful free tier
   and it removes the "you billed me for a fake email" problem.
2. **Ship a small set of real tools an agent already pays someone for.** Web
   reading and extraction is the highest-demand, lowest-partner-dependency
   category and it composes with `fetch_url` you already have.
3. **Price on cost plus margin, not vibes.** Current prices are arbitrary. Set
   each tool's credits from measured provider cost with a target ~60-70% margin.
4. **Make the side-effecting demos real only behind connectors** (Zoho CRM for
   the CRM tools, an email provider for `send_email`). Those are workspace-owned
   credentials, so they are a later phase, not the wedge.

## Plan

### Phase 1 — Fix the catalog's integrity

- Reprice and rename the seven fixtures to `sandbox_*`, 0 credits, with
  `demo: true` and a description that says plainly they return fixtures.
- Keep the old names working as deprecated aliases for one release so any agent
  mid-integration does not break; the alias returns the same result plus a
  `deprecated` field pointing at the new name.
- Update catalog, OpenAPI, MCP, docs, `llms.txt`, and the consistency script.

### Phase 2 — Three real tools

| Tool                 | What it does                                                                      | Cost driver                             | Proposed price             |
| -------------------- | --------------------------------------------------------------------------------- | --------------------------------------- | -------------------------- |
| `web_search`         | Query a search index, return ranked results with snippets                         | search provider, ~$0.005-0.01/query     | 3 credits ($0.03)          |
| `extract_structured` | Fetch a URL (or take text) and return JSON matching a caller-supplied JSON Schema | one small model call via the AI gateway | 5 credits ($0.05)          |
| `crawl_site`         | Bounded crawl (max 25 pages, same origin) returning per-page text                 | N× fetch_url plus concurrency           | 2 credits per page fetched |

`extract_structured` and `crawl_site` need no new third-party account —
extraction runs on the Lovable AI gateway, crawling reuses the `fetch_url`
implementation and its SSRF guards. `web_search` needs one provider key
(Brave Search or Tavily); I will request it as a secret when we get there.

All three are read-only, so no confirmation gate; they are metered, rate limited
and idempotent through the existing path.

### Phase 3 — Fix the per-workspace toggle defect (do this regardless)

Found while reviewing: workspace tool visibility only works for the seven tools
hardcoded in the original seed trigger.

- `setToolEnabled` issues an `UPDATE`, so for any tool without a row (every tool
  added after launch, including `fetch_url`) the toggle silently no-ops and the
  UI snaps back to enabled.
- The `seed_org_tools` trigger has the tool list baked into SQL, so it drifts
  from the code registry on every catalog change.

Fix: make the write an upsert keyed on `(org_id, tool_name)`, backfill missing
rows for every existing workspace and every current tool, and change the trigger
to seed nothing but let the app upsert on first read — one source of truth in
`contracts.ts`.

## Technical notes

- Files touched in phase 1/2: `src/lib/agent/contracts.ts`,
  `src/lib/agent/tools.server.ts`, `src/lib/api/catalog.server.ts`,
  `src/lib/mcp/*`, `src/routes/docs.tsx`, `src/routes/llms[.]txt.ts`,
  `scripts/check-api-consistency.mjs`.
- Phase 3 needs one migration (backfill + trigger change) plus an upsert in
  `src/lib/api/org-tools.server.ts`.
- Credit prices are declared in one place (`contracts.ts`); `usdPerCall` and the
  pricing endpoint derive from them automatically.

## Suggested order

Phase 3 first (small, fixes a live defect), then phase 1, then phase 2 one tool
at a time starting with `extract_structured` since it needs no new vendor.

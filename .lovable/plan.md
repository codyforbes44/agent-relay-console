# Revenue optimization: make RELAY findable, then make it worth paying for

Your research describes exactly the funnel RELAY is built for: agents discover an
endpoint, hit a 402/401, settle payment, and retry. RELAY already has the hard,
rare half of that (x402 on Base, credit metering, bound confirmation tokens,
per-key budgets). What it does not have is the two things that actually produce
revenue: **being in the places agents look**, and **selling something an agent
would pay real money for**.

## The honest blocker first

Every tool in the catalog is flagged `demo: true` and side-effecting results come
back `simulated: true`. `search_knowledge_base` returns fixture text; `send_email`
sends nothing. An agent that discovers RELAY, spends its free 500 credits, and sees
simulated output has no reason to settle a single x402 payment. No amount of
discovery work converts on a simulated catalog.

So the plan has two tracks and they are not equally weighted: **one real tool is
worth more than all the discovery work below.**

## Track 1 — Ship at least one genuinely useful, metered tool

Pick tools where the value is obvious, the output is verifiable, and the cost per
call is low enough to price at a healthy margin. Candidates, cheapest to build first:

- `fetch_url` / `extract_page` — fetch a URL and return clean text or structured
  extraction. Agents pay for this constantly today.
- `web_search` — proxied search with a credit price per query.
- `extract_structured` — URL or raw text plus a JSON Schema, returns conforming
  data (runs through the AI gateway).
- `send_email` for real — a genuinely metered transactional send, keeping the
  existing confirmation-token gate.

Keep the demo catalog as a labeled sandbox tier so the two-step confirmation and
error flows stay demonstrable without a key.

Price each real tool on landed cost with a target margin (start at 3-5x cost), and
publish per-tool USD equivalents next to the credit cost so an agent can budget.

## Track 2 — Be present where agents actually discover services

Ranked by expected return, cheapest first.

1. **Unblock discovery of the machine surface.** `public/robots.txt` currently
   disallows `/mcp` for the wildcard agent. Allow `/mcp`, `/api/public/v1/tools`,
   `/llms.txt`, `/.well-known/*` explicitly, and add `Sitemap` plus a comment
   pointing crawlers at `llms.txt`.
2. **Add the discovery files agents check.** Serve
   `/.well-known/ai-plugin.json` (the OpenAI plugin manifest shape) and
   `/.well-known/agents.json`, both generated from the same contract registry as
   the existing agent manifest — pointing at the catalog, OpenAPI doc, MCP endpoint,
   pricing, and the x402 payment terms. Add `/.well-known/x402` describing accepted
   asset, network, and pay-to address so a paying agent can price the call before
   it makes one.
3. **Make pricing machine-readable.** Add `usdPerCall` and a `pricing` block to the
   catalog and to each tool descriptor, and a `GET /api/public/v1/pricing` endpoint.
   Today an agent can see credits but cannot convert that to dollars without
   scraping the pricing page.
4. **List in the registries agents and their builders query.** Submit to MCP server
   directories (the official MCP servers list, Smithery, Glama, PulseMCP), the x402
   ecosystem/bazaar listings, RapidAPI, and the emerging agent registries. This is
   manual submission work, not code — but it is where the traffic is.
5. **Human-facing SEO for the builders.** The buyer is often the developer wiring
   the agent, not the agent. Add task-shaped landing pages ("pay-per-call web
   search for AI agents", "x402 tool API", "MCP server with per-key budgets") that
   each rank for one intent and funnel to `/connect`.

## Track 3 — Funnel and pricing mechanics

- **Free tier as a conversion instrument.** 500 credits per signup with an
  unauthenticated `/signup` endpoint is generous and abusable. Tighten to a smaller
  grant, and put the remainder behind a first successful x402 settlement (even a
  $1 one) — paying once is the hardest step; make it cheap and early.
- **Instrument the funnel.** Track signup → first call → free-credit exhaustion →
  first payment → repeat payment, and surface it on the admin dashboard. You cannot
  optimize revenue without knowing which step drops.
- **Make the 402 a sales page.** The insufficient-credits body should carry the
  smallest purchasable amount, the exact USD, and a one-line "settle and retry"
  instruction. Every 402 is a checkout page an agent reads.
- **Auto top-up.** Let a key hold a policy ("keep balance above N, settle up to $X
  per day via x402") so a working agent never stalls. Recurring revenue without a
  subscription.
- **Volume pricing.** Credit packs top out at $149. Add a larger pack and a
  committed-spend rate so a high-volume agent has a reason to stay.

## Technical notes

- New discovery routes follow existing patterns: `src/routes/[.]well-known/` for
  the manifests, `src/routes/api/public/v1/` for pricing, both generated from
  `src/lib/agent/contracts.ts` via `src/lib/api/catalog.server.ts` so nothing drifts.
- `scripts/check-api-consistency.mjs` gets assertions for the new surfaces so the
  manifests, pricing, and catalog cannot disagree.
- Real tools need outbound HTTP and possibly the AI gateway; both run inside the
  server handler, keys never reach the browser. Cost per call gets recorded on
  `usage_events` so margin is measurable per tool.
- Auto top-up reuses the existing x402 settlement path plus the per-key budget caps
  already on `agent_keys`.

## Suggested order

1. Robots + discovery manifests + machine-readable pricing (small, unblocks everything).
2. One real tool end to end, priced with a measured margin.
3. Funnel instrumentation and the 402-as-checkout改.
4. Registry submissions and SEO landing pages.
5. Auto top-up and volume tiers.

Confirm which real tool to build first and whether to tighten the free grant, and
the first two steps can ship together.

# AI API Resource Audit & Best-in-Class Roadmap

## Current state

- **Model gateway**: RELAY already uses Lovable AI Gateway, which serves `google/gemini-3.5-flash` for the chat/agent loop and `google/gemini-2.5-flash` for the `extract_structured` tool. No provider keys are exposed to the browser.
- **Live tools**: `fetch_url`, `crawl_site`, `extract_structured` — all read-only, network + model backed.
- **Sandbox tools**: 7 free fixture tools (`sandbox_*`) used to rehearse auth, schemas, idempotency, and confirmation gates.
- **Protocol surface**: REST + OpenAPI + MCP + x402 payment + machine signup.
- **Gaps**: no dedicated web search, no embeddings/vector knowledge base, no code execution, no real browser automation, no document parsing, no image generation, no observability/evaluation layer, and the agent loop is hardcoded to one model family.

## Goal

Determine which external AI API resources are required for RELAY to be considered best-in-class as an agent-native tool marketplace, prioritize them by revenue impact, and define a lean integration plan.

## Recommendation

RELAY is a _platform_ that sells tools to other agents. To be best-in-class, it does not need to build every AI capability itself; it needs to expose the right AI primitives as metered, typed, secure tools. The highest-leverage additions are:

1. **Web search API** — agents need current, summarized web results beyond raw page fetching.
2. **Embeddings + vector knowledge base** — replace the `sandbox_search_knowledge_base` with real semantic search over tenant-owned documents.
3. **Code execution sandbox** — let agents run generated code safely.
4. **Browser automation** — let agents interact with dynamic sites that raw fetch cannot handle.
5. **Model routing / fallbacks** — make the agent loop resilient and model-agnostic.
6. **Agent observability/evaluation** — measure tool success, latency, cost, and quality.

## Proposed external AI APIs

### 1. Web search (P0 — highest revenue impact)

Why: `fetch_url` and `crawl_site` are useful, but agents often need a ranked, summarized answer to a query without choosing URLs. A search tool is a natural credit-burner and a common first call in agent workflows.

Options:

- **Tavily** — built for AI agents, returns structured JSON with citations, cheap, fast.
- **Exa** — neural search, excellent for semantic discovery.
- **Serper** (Google Search API) — reliable, familiar, cheap at scale.
- **Perplexity API** — returns answers with citations, but more expensive and less deterministic.

Recommended: **Tavily** for general AI search, with a future option to add **Exa** for semantic/neural search as a premium tool.

### 2. Embeddings + vector knowledge base (P0)

Why: The current `sandbox_search_knowledge_base` is a fixture. A real vector knowledge base lets tenants upload documents and query them semantically. This turns RELAY from a tool API into a memory/retrieval layer for agents.

Options:

- **Supabase pgvector** (already available via Lovable Cloud) + an embedding model from Lovable AI Gateway (`text-embedding-3-small`, `text-embedding-3-large`, or `google/text-embedding-004`).
- **Pinecone / Weaviate / Qdrant** if scale or hybrid search is needed later.

Recommended: Use **Supabase pgvector** + Lovable AI Gateway embeddings. This keeps data tenant-scoped under existing RLS and adds no new vendor.

### 3. Code execution (P1)

Why: Agents that reason about code need to run it. A `run_code` tool is a high-value, defensible capability.

Options:

- **E2B** — sandboxes for AI-generated code, fast, ephemeral, supports Python/JS.
- **Modal** — more general serverless compute.
- **Firecracker-based custom sandbox** — high effort.

Recommended: **E2B** for a managed, secure, metered code execution tool.

### 4. Browser automation (P1)

Why: Many modern sites require JavaScript, login sessions, or form interaction. Raw fetch cannot handle these.

Options:

- **Browserbase** — headless browsers for agents, good API.
- **Firecrawl** — scrape + crawl with JS rendering, good for agents.
- **ScrapingBee** — simpler proxy + JS rendering.

Recommended: **Browserbase** for interactive browser sessions; add **Firecrawl** later as a cheaper scraping option.

### 5. Model routing / fallbacks (P1)

Why: The agent loop is hardcoded to `google/gemini-3.5-flash`. Best-in-class platforms should route to the best available model, fall back on failures, and expose model choice as a workspace setting.

Options:

- Already on Lovable AI Gateway; can call multiple models (`google/gemini-3.6-flash`, `openai/gpt-5.5`, `openai/gpt-5.6-terra`, etc.) from the same gateway key.
- Add a small router that picks model by task complexity or cost target.

Recommended: **No new vendor**. Implement model routing within Lovable AI Gateway. Add a workspace setting for preferred model / cost-quality tier.

### 6. Document parsing (P2)

Why: Tenants will upload PDFs, DOCX, images of documents. Extracting clean text + tables + images is a common AI agent need.

Options:

- **Unstructured API** — gold standard for messy documents.
- **LlamaParse** — excellent for complex PDFs with tables.
- **Lovable AI Gateway multimodal models** — can already describe images and read documents via chat/completions.

Recommended: Start with **Lovable AI Gateway multimodal models** for image/PDF understanding, then add **Unstructured** or **LlamaParse** if extraction quality becomes a differentiator.

### 7. Agent observability / evaluation (P2)

Why: As the tool catalog grows, RELAY needs to track latency, cost, success rate, and user satisfaction per tool. This is both an operational necessity and a product differentiator (tenants can see which tools are reliable).

Options:

- **Langfuse** — open-source, self-hostable or managed, good for tracing.
- **LangSmith** — if using LangChain (not currently used).
- **Braintrust** — strong evaluation framework.
- **Custom**: store traces in Supabase; cheaper, but more build effort.

Recommended: Start with a **custom trace table in Supabase** (cost, latency, model, tool, result summary) for transparency, then add **Langfuse** if advanced evaluation is needed.

### 8. Image generation / editing (P3)

Why: Not core to the current positioning, but easy to add as a credit-burning premium tool.

Options:

- Lovable AI Gateway already has image models (`google/gemini-2.5-flash-image`, `google/gemini-3-pro-image`, etc.).

Recommended: **No new vendor** — expose gateway image models as a new tool when requested.

## What to avoid adding now

- **Standalone vector DBs** (Pinecone, Weaviate) — Supabase pgvector is sufficient until multi-tenant scale demands it.
- **Niche model providers** (Mistral, Cohere, Groq) — Lovable AI Gateway covers the mainstream; add only if a specific customer demands it.
- **General SaaS integrations** (Salesforce, HubSpot, SendGrid, Stripe) — these are important revenue tools, but they are _SaaS integrations_, not _AI API resources_. Treat them as separate marketplace connectors, not AI primitives.

## Implementation plan

### Phase 1 — Foundation (ship first)

1. Add `search_web` tool using **Tavily** (metered, read-only, returns JSON with citations).
2. Replace `sandbox_search_knowledge_base` with a real vector knowledge base:
   - Add `documents` table with tenant RLS.
   - Add `document_chunks` table with pgvector `embedding` column.
   - Add `search_knowledge_base` tool that embeds the query and runs nearest-neighbor search.
3. Add model routing in the agent loop:
   - Workspace setting: `default_model` and `cost_quality_tier`.
   - Router picks from Lovable AI Gateway models.

### Phase 2 — Agent superpowers

4. Add `run_code` tool using **E2B** (metered, sandboxed, time-limited).
5. Add `browse_page` tool using **Browserbase** (metered, interactive browser sessions).
6. Add `parse_document` tool using Lovable AI Gateway multimodal models for PDF/image extraction.

### Phase 3 — Observability & premium

7. Add a `tool_traces` table and a workspace-level observability dashboard.
8. Add `generate_image` tool using Lovable AI Gateway image models.
9. Evaluate adding **Exa** for premium semantic search.

## Secrets required

- `TAVILY_API_KEY` (P0)
- `E2B_API_KEY` (P1)
- `BROWSERBASE_API_KEY` (P1)
- No new secrets for pgvector, model routing, document parsing, or image generation — all use existing Lovable Cloud + Lovable AI Gateway.

## Success criteria

- At least 5 real, metered AI-backed tools (currently 3).
- A tenant can upload documents and query them semantically.
- The agent loop can be configured per workspace for cost vs. quality.
- Every tool call has latency/cost traces visible in the console.

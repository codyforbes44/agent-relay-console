/**
 * Simulated tool handlers. Each returns a compact, serializable result.
 * Swap these bodies for real integrations without touching the agent loop
 * or the UI: the typed contracts in `contracts.ts` stay the same.
 */

import { tavily } from "@tavily/core";

import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

const CONTACTS = [
  { id: "c_1024", name: "Dana Whitfield", email: "dana@northwind.io", company: "Northwind", stage: "customer", mrr: 4200 },
  { id: "c_1088", name: "Marcus Lee", email: "marcus@lumenlabs.dev", company: "Lumen Labs", stage: "trial", mrr: 0 },
  { id: "c_1131", name: "Priya Raman", email: "priya@fernbrook.co", company: "Fernbrook", stage: "customer", mrr: 890 },
];

const KB = [
  { title: "Refund policy", body: "Refunds are issued within 14 days of purchase for annual plans, pro-rated after that." },
  { title: "Escalation runbook", body: "Sev-1 incidents page the on-call engineer and require a status page update within 15 minutes." },
  { title: "Onboarding checklist", body: "New workspaces get a kickoff call, a sandbox tenant, and a 30-day success review." },
];

function ok<T>(data: T) {
  return { ok: true as const, ...data };
}

const FETCH_TIMEOUT_MS = 15_000;
const FETCH_MAX_BYTES = 2_000_000;

/** Strips scripts/styles/tags and collapses whitespace into readable text. */
function htmlToText(html: string): { title: string | null; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return { title, text };
}

/**
 * Real outbound fetch. Blocks non-https schemes and obvious internal hosts so
 * this metered tool can never be used to probe our own network.
 */
async function fetchUrl(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const raw = String(args['url'] ?? "").trim();
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return { ok: false, error: "url must be an absolute URL, e.g. https://example.com" };
  }
  if (target.protocol !== "https:") {
    return { ok: false, error: "Only https:// URLs are supported" };
  }
  const host = target.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal" ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "[::1]";
  if (blocked) return { ok: false, error: "That host is not reachable from this API" };

  const maxChars = Math.min(Math.max(Number(args['maxChars'] ?? 8000) || 8000, 200), 50_000);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(target.toString(), {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5",
        "user-agent": "RelayFetchBot/1.0 (+https://3bi.ai/docs)",
      },
    });
    const contentType = res.headers.get("content-type") ?? "";
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > FETCH_MAX_BYTES) {
      return { ok: false, error: "Response is larger than the 2 MB fetch limit" };
    }
    const body = new TextDecoder().decode(buffer);

    let title: string | null = null;
    let text = body;
    if (contentType.includes("html")) {
      const parsed = htmlToText(body);
      title = parsed.title;
      text = parsed.text;
    }
    const truncated = text.length > maxChars;

    return ok({
      url: res.url || target.toString(),
      status: res.status,
      contentType: contentType || null,
      title,
      text: truncated ? text.slice(0, maxChars) : text,
      chars: truncated ? maxChars : text.length,
      truncated,
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return {
      ok: false,
      error: aborted
        ? `The target did not respond within ${FETCH_TIMEOUT_MS / 1000}s`
        : e instanceof Error
          ? e.message
          : "Fetch failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Shared fetch+extract used by fetch_url, crawl_site and extract_structured. */
async function fetchReadable(
  rawUrl: string,
  maxChars: number,
): Promise<{ ok: true; url: string; status: number; title: string | null; text: string } | { ok: false; error: string }> {
  const result = (await fetchUrl({ url: rawUrl, maxChars })) as Record<string, unknown>;
  if (result['ok'] !== true) {
    return { ok: false, error: String(result['error'] ?? "Fetch failed") };
  }
  return {
    ok: true,
    url: String(result['url']),
    status: Number(result['status']),
    title: (result['title'] as string | null) ?? null,
    text: String(result['text'] ?? ""),
  };
}

/** Same-origin links, in document order, de-duplicated. */
function sameOriginLinks(html: string, base: URL, limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>([base.toString()]);
  const re = /<a\s[^>]*href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < limit) {
    const href = m[1];
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("javascript:")) continue;
    let next: URL;
    try {
      next = new URL(href, base);
    } catch {
      continue;
    }
    next.hash = "";
    if (next.protocol !== "https:" || next.host !== base.host) continue;
    const key = next.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * Crawls a small set of same-origin pages starting from a seed URL.
 * Sequential by design: the target site sees one request at a time.
 */
async function crawlSite(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const seed = String(args['url'] ?? "").trim();
  let base: URL;
  try {
    base = new URL(seed);
  } catch {
    return { ok: false, error: "url must be an absolute https:// URL" };
  }
  const maxPages = Math.min(Math.max(Number(args['maxPages'] ?? 3) || 3, 1), 10);
  const maxChars = Math.min(Math.max(Number(args['maxCharsPerPage'] ?? 4000) || 4000, 200), 20_000);

  const first = await fetchReadable(base.toString(), maxChars);
  if (!first.ok) return { ok: false, error: first.error };

  const pages: Record<string, unknown>[] = [
    { url: first.url, status: first.status, title: first.title, text: first.text, chars: first.text.length },
  ];

  if (maxPages > 1) {
    // Re-fetch raw HTML for link discovery; fetchUrl returns stripped text.
    let links: string[] = [];
    try {
      const res = await fetch(base.toString(), {
        redirect: "follow",
        headers: { "user-agent": "RelayFetchBot/1.0 (+https://3bi.ai/docs)" },
      });
      links = sameOriginLinks(await res.text(), new URL(res.url || base.toString()), maxPages - 1);
    } catch {
      links = [];
    }
    for (const link of links) {
      const page = await fetchReadable(link, maxChars);
      if (!page.ok) {
        pages.push({ url: link, error: page.error });
        continue;
      }
      pages.push({ url: page.url, status: page.status, title: page.title, text: page.text, chars: page.text.length });
    }
  }

  return ok({
    seed: base.toString(),
    pageCount: pages.length,
    pages,
    crawledAt: new Date().toISOString(),
  });
}

/**
 * Turns a page (or supplied text) into structured JSON for the requested
 * fields, using the server-side model gateway. No provider key ever leaves
 * the server, and the caller only pays credits.
 */
async function extractStructured(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const fields = Array.isArray(args['fields']) ? (args['fields'] as unknown[]).map(String).filter(Boolean) : [];
  if (fields.length === 0) return { ok: false, error: "fields must be a non-empty array of field names" };

  let source = typeof args['text'] === "string" ? (args['text'] as string) : "";
  let sourceUrl: string | null = null;
  if (!source) {
    const url = String(args['url'] ?? "").trim();
    if (!url) return { ok: false, error: "Provide either url or text" };
    const page = await fetchReadable(url, 12_000);
    if (!page.ok) return { ok: false, error: page.error };
    source = page.text;
    sourceUrl = page.url;
  }
  if (!source.trim()) return { ok: false, error: "Nothing readable to extract from" };

  const apiKey = process.env['LOVABLE_API_KEY'];
  if (!apiKey) return { ok: false, error: "Extraction is temporarily unavailable" };

  const instruction = String(args['instruction'] ?? "").trim();

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content:
            "You extract structured data from documents. Reply with a single JSON object containing exactly the requested keys. Use null when a value is not present. No prose, no markdown fences.",
        },
        {
          role: "user",
          content: `Fields: ${fields.join(", ")}\n${instruction ? `Instruction: ${instruction}\n` : ""}Document:\n${source.slice(0, 12_000)}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) return { ok: false, error: "Extraction rate limit reached, retry shortly" };
    return { ok: false, error: `Extraction failed [${res.status}]: ${body.slice(0, 300)}` };
  }

  const payload = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = payload.choices?.[0]?.message?.content ?? "";
  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "Model did not return valid JSON", raw: cleaned.slice(0, 500) };
  }

  const fieldsOut: Record<string, unknown> = {};
  for (const f of fields) fieldsOut[f] = f in data ? data[f] : null;

  return ok({
    sourceUrl,
    fields: fieldsOut,
    missing: fields.filter((f) => fieldsOut[f] === null || fieldsOut[f] === undefined),
    extractedAt: new Date().toISOString(),
  });
}

/**
 * Real web search via Tavily. Returns ranked results with citations for agents.
 */
async function searchWeb(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const apiKey = process.env['TAVILY_API_KEY'];
  if (!apiKey) return { ok: false, error: "Web search is not configured" };

  const query = String(args['query'] ?? "").trim();
  if (!query) return { ok: false, error: "query is required" };

  const maxResults = Math.min(Math.max(Number(args['maxResults'] ?? 5) || 5, 1), 20);
  const includeAnswer = Boolean(args['includeAnswer'] ?? false);

  try {
    const tv = tavily({ apiKey });
    const res = await tv.search(query, {
      maxResults,
      includeAnswer: includeAnswer ? "basic" : undefined,
      searchDepth: "basic",
    });

    return ok({
      query,
      results: (res.results ?? []).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        content: r.content ?? "",
        score: r.score ?? 0,
      })),
      answer: typeof res.answer === "string" ? res.answer : null,
      searchedAt: new Date().toISOString(),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Web search failed" };
  }
}

/**
 * Real semantic knowledge-base search over workspace documents using pgvector.
 * Embeds the query through the Lovable AI Gateway, then queries tenant-scoped chunks.
 */
async function searchKnowledgeBase(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const query = String(args['query'] ?? "").trim();
  if (!query) return { ok: false, error: "query is required" };

  const orgId = typeof args['orgId'] === "string" ? args['orgId'] : null;
  if (!orgId) return { ok: false, error: "orgId is required for knowledge base search" };

  const maxResults = Math.min(Math.max(Number(args['maxResults'] ?? 5) || 5, 1), 20);
  const documentIds = Array.isArray(args['documentIds']) ? (args['documentIds'] as unknown[]).map(String) : null;

  const apiKey = process.env['LOVABLE_API_KEY'];
  if (!apiKey) return { ok: false, error: "Knowledge base search is temporarily unavailable" };

  try {
    const gateway = createLovableAiGatewayProvider(apiKey);
    const embedRes = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
      method: "POST",
      headers: {
        "Lovable-API-Key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/text-embedding-3-large",
        input: query,
      }),
    });
    if (!embedRes.ok) {
      const body = await embedRes.text();
      return { ok: false, error: `Embedding failed [${embedRes.status}]: ${body.slice(0, 200)}` };
    }
    const embedJson = (await embedRes.json()) as { data?: { embedding: number[] }[] };
    const embedding = embedJson.data?.[0]?.embedding;
    if (!embedding || embedding.length !== 3072) {
      return { ok: false, error: "Invalid embedding response from model gateway" };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("match_document_chunks", {
      _org_id: orgId,
      _query_embedding: embedding,
      _match_count: maxResults,
      _document_ids: documentIds?.length ? documentIds : null,
    });
    if (error) {
      return { ok: false, error: `Search failed: ${error.message}` };
    }

    const matches = (data ?? []) as Array<{
      id: string;
      document_id: string;
      chunk_index: number;
      content: string;
      metadata: Record<string, unknown>;
      similarity: number;
    }>;

    // Fetch document titles for the matched chunks.
    const docIds = [...new Set(matches.map((m) => m.document_id))];
    const { data: docs } = await supabaseAdmin
      .from("documents")
      .select("id, title, source_url")
      .in("id", docIds.length ? docIds : ["00000000-0000-0000-0000-000000000000"]);
    const docMap = Object.fromEntries((docs ?? []).map((d) => [d.id as string, d as { title?: string; source_url?: string | null }]));

    return ok({
      query,
      matches: matches.map((m) => ({
        documentId: m.document_id,
        chunkIndex: m.chunk_index,
        title: docMap[m.document_id]?.title ?? "Untitled",
        sourceUrl: docMap[m.document_id]?.source_url ?? null,
        content: m.content,
        similarity: m.similarity,
      })),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Knowledge base search failed" };
  }
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (name) {
    case "fetch_url":
      return fetchUrl(args);
    case "crawl_site":
      return crawlSite(args);
    case "extract_structured":
      return extractStructured(args);
    case "sandbox_search_knowledge_base": {
      const q = String(args['query'] ?? "").toLowerCase();
      const hits = KB.filter(
        (d) => d.title.toLowerCase().includes(q) || d.body.toLowerCase().includes(q),
      );
      return ok({ matches: (hits.length ? hits : KB).slice(0, 3) });
    }
    case "sandbox_lookup_crm_contact": {
      const email = String(args['email'] ?? "").toLowerCase();
      const contact = CONTACTS.find((c) => c.email.toLowerCase() === email);
      return contact ? ok({ contact }) : { ok: false, error: "No contact found for that email" };
    }
    case "sandbox_list_records": {
      const type = String(args['type'] ?? "contacts");
      const status = args['status'] ? String(args['status']) : null;
      const limit = Math.min(Math.max(Number(args['limit'] ?? 25) || 25, 1), 100);
      const offset = Number.parseInt(String(args['cursor'] ?? "0"), 10) || 0;

      const all: Array<Record<string, unknown>> =
        type === "contacts"
          ? (CONTACTS as unknown as Array<Record<string, unknown>>)
          : type === "invoices"
            ? [
                { id: "in_881", contact: "dana@northwind.io", amountCents: 420000, status: "paid" },
                { id: "in_882", contact: "priya@fernbrook.co", amountCents: 89000, status: "open" },
              ]
            : [
                { id: "t_51", subject: "SSO login loop", priority: "high", status: "open" },
                { id: "t_52", subject: "Export missing columns", priority: "normal", status: "pending" },
              ];

      const filtered = status
        ? all.filter((r) => r['status'] === status || r['stage'] === status)
        : all;
      const rows = filtered.slice(offset, offset + limit);
      const next = offset + limit;

      return ok({
        type,
        count: rows.length,
        rows,
        nextCursor: next < filtered.length ? String(next) : null,
      });
    }
    case "sandbox_send_email":
      return ok({
        simulated: true,
        messageId: `sim_${crypto.randomUUID().slice(0, 8)}`,
        to: args['to'],
        subject: args['subject'],
        deliveredAt: new Date().toISOString(),
      });
    case "sandbox_update_crm_record":
      return ok({
        simulated: true,
        recordId: args['recordId'],
        updatedFields: args['fields'],
        updatedAt: new Date().toISOString(),
      });
    case "sandbox_create_payment":
      return ok({
        simulated: true,
        paymentId: `pay_${crypto.randomUUID().slice(0, 8)}`,
        customerId: args['customerId'],
        amountCents: args['amountCents'],
        currency: args['currency'],
        status: "succeeded",
      });
    case "sandbox_delete_record":
      return ok({
        simulated: true,
        deleted: { type: args['type'], recordId: args['recordId'] },
        deletedAt: new Date().toISOString(),
      });
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}

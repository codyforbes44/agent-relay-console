/**
 * Simulated tool handlers. Each returns a compact, serializable result.
 * Swap these bodies for real integrations without touching the agent loop
 * or the UI: the typed contracts in `contracts.ts` stay the same.
 */

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

export async function runTool(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (name) {
    case "fetch_url":
      return fetchUrl(args);
    case "search_knowledge_base": {
      const q = String(args['query'] ?? "").toLowerCase();
      const hits = KB.filter(
        (d) => d.title.toLowerCase().includes(q) || d.body.toLowerCase().includes(q),
      );
      return ok({ matches: (hits.length ? hits : KB).slice(0, 3) });
    }
    case "lookup_crm_contact": {
      const email = String(args['email'] ?? "").toLowerCase();
      const contact = CONTACTS.find((c) => c.email.toLowerCase() === email);
      return contact ? ok({ contact }) : { ok: false, error: "No contact found for that email" };
    }
    case "list_records": {
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
    case "send_email":
      return ok({
        simulated: true,
        messageId: `sim_${crypto.randomUUID().slice(0, 8)}`,
        to: args['to'],
        subject: args['subject'],
        deliveredAt: new Date().toISOString(),
      });
    case "update_crm_record":
      return ok({
        simulated: true,
        recordId: args['recordId'],
        updatedFields: args['fields'],
        updatedAt: new Date().toISOString(),
      });
    case "create_payment":
      return ok({
        simulated: true,
        paymentId: `pay_${crypto.randomUUID().slice(0, 8)}`,
        customerId: args['customerId'],
        amountCents: args['amountCents'],
        currency: args['currency'],
        status: "succeeded",
      });
    case "delete_record":
      return ok({
        simulated: true,
        deleted: { type: args['type'], recordId: args['recordId'] },
        deletedAt: new Date().toISOString(),
      });
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}

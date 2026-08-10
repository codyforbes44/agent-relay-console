import { z } from "zod";

/**
 * Typed tool contracts shared by the agent runtime (server), the public
 * machine API and the tool timeline UI (client). Handlers live in
 * `tools.server.ts` so no provider credentials ever reach the browser.
 *
 * This registry is the single source of truth for: the human console, the
 * public REST catalog, the OpenAPI document, the MCP server, the docs page
 * examples and per-call credit pricing.
 */
export type ToolContract = {
  name: string;
  label: string;
  description: string;
  /** Side-effecting tools require explicit user confirmation before running. */
  sideEffecting: boolean;
  icon: "search" | "user" | "list" | "mail" | "database" | "credit-card" | "trash" | "globe";
  schema: z.ZodType<Record<string, unknown>>;
  /** Credits burned per successful call on the public API. */
  credits: number;
  /** Exposed on the public machine API + OpenAPI catalog. */
  publicApi: boolean;
  /** Simulated fixture rather than a real integration. */
  demo: boolean;
  /** Copy-pasteable request body, published in the catalog, OpenAPI and docs. */
  example: Record<string, unknown>;
  /** Shape of the `result` field on a successful call, for the same surfaces. */
  exampleResult: Record<string, unknown>;
  /** Short human summary of the arguments, shown in the timeline. */
  summarize: (args: Record<string, unknown>) => string;
};

const str = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v ?? ""));

export const TOOL_CONTRACTS: ToolContract[] = [
  {
    // The first non-demo tool: a real outbound fetch with readable text
    // extraction. This is the call agents already pay for elsewhere.
    name: "fetch_url",
    label: "Fetch URL",
    description:
      "Fetch a public web page or JSON endpoint over HTTPS and return its readable text content plus metadata. Real network call, not a simulation. Read-only.",
    sideEffecting: false,
    icon: "globe",
    credits: 2,
    publicApi: true,
    demo: false,
    schema: z.object({
      url: z.string().describe("Absolute https:// URL to fetch"),
      maxChars: z
        .number()
        .optional()
        .describe("Truncate the extracted text to this many characters (default 8000, max 50000)"),
    }) as unknown as z.ZodType<Record<string, unknown>>,
    example: { url: "https://example.com" },
    exampleResult: {
      ok: true,
      url: "https://example.com/",
      status: 200,
      contentType: "text/html",
      title: "Example Domain",
      text: "Example Domain. This domain is for use in illustrative examples in documents...",
      chars: 208,
      truncated: false,
      fetchedAt: "2026-08-09T20:15:18.358Z",
    },
    summarize: (a) => str(a['url']),
  },
  {
    // Real crawl: same-origin pages only, sequential, hard page cap.
    name: "crawl_site",
    label: "Crawl site",
    description:
      "Crawl a public site starting from one https:// URL and return readable text for that page plus up to nine same-origin pages it links to. Real network calls. Read-only.",
    sideEffecting: false,
    icon: "globe",
    credits: 6,
    publicApi: true,
    demo: false,
    schema: z.object({
      url: z.string().describe("Absolute https:// seed URL"),
      maxPages: z.number().optional().describe("Total pages to fetch, 1-10. Defaults to 3"),
      maxCharsPerPage: z
        .number()
        .optional()
        .describe("Truncate each page's text to this many characters (default 4000, max 20000)"),
    }) as unknown as z.ZodType<Record<string, unknown>>,
    example: { url: "https://example.com", maxPages: 3 },
    exampleResult: {
      ok: true,
      seed: "https://example.com",
      pageCount: 2,
      pages: [
        {
          url: "https://example.com/",
          status: 200,
          title: "Example Domain",
          text: "Example Domain. This domain is for use in illustrative examples...",
          chars: 208,
        },
      ],
      crawledAt: "2026-08-09T20:15:18.358Z",
    },
    summarize: (a) => `${str(a['url'])} · ${Number(a['maxPages'] ?? 3)} pages`,
  },
  {
    // Real model-backed extraction. The provider key stays server-side.
    name: "extract_structured",
    label: "Extract structured data",
    description:
      "Extract named fields as JSON from a public URL or supplied text, using a server-side model. Returns one value per requested field, or null when absent. Read-only.",
    sideEffecting: false,
    icon: "list",
    credits: 8,
    publicApi: true,
    demo: false,
    schema: z.object({
      fields: z
        .array(z.string())
        .describe("Field names to extract, e.g. [\"companyName\", \"pricingModel\"]"),
      url: z.string().optional().describe("Absolute https:// URL to read. Required unless text is given"),
      text: z.string().optional().describe("Raw text to extract from instead of fetching a URL"),
      instruction: z.string().optional().describe("Optional extra guidance for the extraction"),
    }) as unknown as z.ZodType<Record<string, unknown>>,
    example: { url: "https://example.com", fields: ["title", "purpose"] },
    exampleResult: {
      ok: true,
      sourceUrl: "https://example.com/",
      fields: { title: "Example Domain", purpose: "Illustrative examples in documents" },
      missing: [],
      extractedAt: "2026-08-09T20:15:18.358Z",
    },
    summarize: (a) =>
      `${Array.isArray(a['fields']) ? (a['fields'] as unknown[]).length : 0} fields${a['url'] ? ` · ${str(a['url'])}` : ""}`,
  },
  {
    // Real web search: Tavily returns ranked results with citations for agents.
    name: "search_web",
    label: "Search web",
    description:
      "Search the public web and return ranked results with titles, snippets, and source URLs. Uses a server-side search API. Read-only.",
    sideEffecting: false,
    icon: "search",
    credits: 4,
    publicApi: true,
    demo: false,
    schema: z.object({
      query: z.string().describe("Natural language search query"),
      maxResults: z.number().optional().describe("Number of results to return, 1-20. Defaults to 5"),
      includeAnswer: z.boolean().optional().describe("Include a short AI-generated answer based on the results. Defaults to false"),
    }) as unknown as z.ZodType<Record<string, unknown>>,
    example: { query: "x402 payment protocol summary" },
    exampleResult: {
      ok: true,
      query: "x402 payment protocol summary",
      results: [
        {
          title: "x402 - Machine-payable HTTP",
          url: "https://x402.org",
          content: "x402 is a protocol for machine payments over HTTP using stablecoins...",
          score: 0.94,
        },
      ],
      answer: "x402 lets servers request on-chain payment by returning HTTP 402.",
      searchedAt: "2026-08-09T20:15:18.358Z",
    },
    summarize: (a) => `"${str(a['query'])}"`,
  },
  {
    // Real vector knowledge base: tenant-scoped semantic search over uploaded documents.
    name: "search_knowledge_base",
    label: "Search knowledge base",
    description:
      "Search this workspace's uploaded documents using semantic similarity. Returns the most relevant text chunks with document titles and source URLs. Read-only.",
    sideEffecting: false,
    icon: "search",
    credits: 3,
    publicApi: true,
    demo: false,
    schema: z.object({
      query: z.string().describe("Natural language search query"),
      maxResults: z.number().optional().describe("Number of chunks to return, 1-20. Defaults to 5"),
      documentIds: z.array(z.string()).optional().describe("Optional list of document IDs to restrict the search to"),
    }) as unknown as z.ZodType<Record<string, unknown>>,
    example: { query: "refund policy" },
    exampleResult: {
      ok: true,
      matches: [
        {
          documentId: "doc_...",
          chunkIndex: 0,
          title: "Refund policy",
          sourceUrl: null,
          content: "Refunds are issued within 14 days of purchase for annual plans...",
          similarity: 0.91,
        },
      ],
    },
    summarize: (a) => `"${str(a['query'])}"`,
  },
  {
    // Real code execution in a sandboxed environment.
    name: "execute_code",
    label: "Execute code",
    description:
      "Run Python or JavaScript code in a sandboxed E2B environment and return stdout, stderr, and the exit code. The environment is ephemeral and isolated. Side-effecting: file writes are scoped to the sandbox only.",
    sideEffecting: false,
    icon: "database",
    credits: 8,
    publicApi: true,
    demo: false,
    schema: z.object({
      code: z.string().describe("Python or JavaScript code to execute"),
      language: z.enum(["python", "javascript"]).optional().describe("Language. Defaults to python"),
      timeout: z.number().optional().describe("Timeout in seconds, 1-300. Defaults to 60"),
    }) as unknown as z.ZodType<Record<string, unknown>>,
    example: { code: "print('hello')", language: "python" },
    exampleResult: {
      ok: true,
      language: "python",
      stdout: "hello\n",
      stderr: "",
      exitCode: 0,
      executedAt: "2026-08-09T20:15:18.358Z",
    },
    summarize: (a) => `${str(a['language'] ?? "python")} snippet`,
  },
  {
    // Real browser automation: open a page, interact, and return a snapshot.
    name: "browse_page",
    label: "Browse page",
    description:
      "Open a URL in a remote browser (Browserbase), run optional actions (click, type, wait), and return the final page text, URL, and a screenshot URL. Useful for interactive sites and post-login flows.",
    sideEffecting: false,
    icon: "globe",
    credits: 10,
    publicApi: true,
    demo: false,
    schema: z.object({
      url: z.string().describe("URL to open"),
      actions: z
        .array(
          z.object({
            type: z.enum(["click", "type", "wait", "navigate"]),
            selector: z.string().optional(),
            value: z.string().optional(),
            delay: z.number().optional().describe("Milliseconds to wait for wait actions"),
          }),
        )
        .optional()
        .describe("Optional interaction steps to perform after load"),
      screenshot: z.boolean().optional().describe("Return a screenshot URL. Defaults to true"),
    }) as unknown as z.ZodType<Record<string, unknown>>,
    example: {
      url: "https://example.com",
      actions: [{ type: "wait", delay: 1000 }],
      screenshot: true,
    },
    exampleResult: {
      ok: true,
      url: "https://example.com/",
      title: "Example Domain",
      text: "Example Domain. This domain is for use in illustrative examples...",
      screenshotUrl: "https://browserbase.com/screenshots/...",
      finishedAt: "2026-08-09T20:15:18.358Z",
    },
    summarize: (a) => str(a['url']),
  },
  {
    name: "sandbox_search_knowledge_base",
    label: "Search knowledge base (sandbox)",
    description:
      "Sandbox: searches a fixed set of fixture documents and returns simulated matches. Free — use it to exercise the API, not for real knowledge.",
    sideEffecting: false,
    icon: "search",
    credits: 0,
    publicApi: true,
    demo: true,
    schema: z.object({
      query: z.string().describe("Natural language search query"),
    }) as unknown as z.ZodType<Record<string, unknown>>,
    example: { query: "refund policy" },
    exampleResult: {
      ok: true,
      matches: [
        {
          title: "Refund policy",
          body: "Refunds are issued within 14 days of purchase for annual plans, pro-rated after that.",
        },
      ],
    },
    summarize: (a) => `"${str(a['query'])}"`,
  },
  {
    name: "sandbox_lookup_crm_contact",
    label: "Look up CRM contact (sandbox)",
    description:
      "Sandbox: returns a fixture CRM contact by email. Free — no real CRM is queried.",
    sideEffecting: false,
    icon: "user",
    credits: 0,
    publicApi: true,
    demo: true,
    schema: z.object({
      email: z.string().describe("Contact email address"),
    }) as unknown as z.ZodType<Record<string, unknown>>,
    example: { email: "dana@northwind.io" },
    exampleResult: {
      ok: true,
      contact: {
        id: "c_1024",
        name: "Dana Whitfield",
        email: "dana@northwind.io",
        company: "Northwind",
        stage: "customer",
        mrr: 4200,
      },
    },
    summarize: (a) => str(a['email']),
  },
  {
    name: "sandbox_list_records",
    label: "List records (sandbox)",
    description:
      "Sandbox: lists fixture records (contacts, invoices, tickets) with paging and filtering. Free — no real data.",
    sideEffecting: false,
    icon: "list",
    credits: 0,
    publicApi: true,
    demo: true,
    schema: z.object({
      type: z.string().describe("Record type: contacts, invoices or tickets"),
      status: z.string().optional().describe("Optional status filter; omit for all records"),
      limit: z.number().optional().describe("Page size, 1-100. Defaults to 25"),
      cursor: z.string().optional().describe("Opaque cursor from a previous nextCursor"),
    }) as unknown as z.ZodType<Record<string, unknown>>,
    example: { type: "invoices", limit: 25 },
    exampleResult: {
      ok: true,
      type: "invoices",
      count: 2,
      rows: [
        { id: "in_881", contact: "dana@northwind.io", amountCents: 420000, status: "paid" },
        { id: "in_882", contact: "priya@fernbrook.co", amountCents: 89000, status: "open" },
      ],
      nextCursor: null,
    },
    summarize: (a) => `${str(a['type'])}${a['status'] ? ` · ${str(a['status'])}` : ""}`,
  },
  {
    name: "sandbox_send_email",
    label: "Send email (sandbox)",
    description:
      "Sandbox: simulates sending an email and returns a fake message id. Nothing is delivered. Free, and still side-effecting so you can exercise the confirmation flow.",
    sideEffecting: true,
    icon: "mail",
    credits: 0,
    publicApi: true,
    demo: true,
    schema: z.object({
      to: z.string().describe("Recipient email address"),
      subject: z.string().describe("Email subject"),
      body: z.string().describe("Plain text email body"),
    }) as unknown as z.ZodType<Record<string, unknown>>,
    example: {
      to: "dana@northwind.io",
      subject: "Your invoice is ready",
      body: "Hi Dana — invoice in_881 is attached. Thanks!",
    },
    exampleResult: {
      ok: true,
      simulated: true,
      messageId: "sim_4f2a91cd",
      to: "dana@northwind.io",
      subject: "Your invoice is ready",
      deliveredAt: "2026-08-09T20:15:18.358Z",
    },
    summarize: (a) => `${str(a['to'])} — ${str(a['subject'])}`,
  },
  {
    name: "sandbox_update_crm_record",
    label: "Update CRM record (sandbox)",
    description:
      "Sandbox: simulates updating a CRM record. Nothing is written. Free, and still side-effecting so you can exercise the confirmation flow.",
    sideEffecting: true,
    icon: "database",
    credits: 0,
    publicApi: true,
    demo: true,
    schema: z.object({
      recordId: z.string().describe("CRM record id"),
      fields: z
        .record(z.string(), z.unknown())
        .describe("Object of field names to new values, e.g. { stage: \"churn_risk\" }"),
    }) as unknown as z.ZodType<Record<string, unknown>>,
    example: { recordId: "c_1024", fields: { stage: "churn_risk", owner: "ae_12" } },
    exampleResult: {
      ok: true,
      simulated: true,
      recordId: "c_1024",
      updatedFields: { stage: "churn_risk", owner: "ae_12" },
      updatedAt: "2026-08-09T20:15:18.358Z",
    },
    summarize: (a) => str(a['recordId']),
  },
  {
    name: "sandbox_create_payment",
    label: "Create payment (sandbox)",
    description:
      "Sandbox: simulates creating a payment charge. No money moves. Free, and still side-effecting so you can exercise the confirmation flow.",
    sideEffecting: true,
    icon: "credit-card",
    credits: 0,
    publicApi: true,
    demo: true,
    schema: z.object({
      customerId: z.string().describe("Customer id"),
      amountCents: z.number().describe("Amount in cents"),
      currency: z.string().describe("ISO currency code, e.g. usd"),
    }) as unknown as z.ZodType<Record<string, unknown>>,
    example: { customerId: "c_1024", amountCents: 4200, currency: "usd" },
    exampleResult: {
      ok: true,
      simulated: true,
      paymentId: "pay_9c31be40",
      customerId: "c_1024",
      amountCents: 4200,
      currency: "usd",
      status: "succeeded",
    },
    summarize: (a) =>
      `${(Number(a['amountCents'] ?? 0) / 100).toFixed(2)} ${str(a['currency']).toUpperCase()} · ${str(a['customerId'])}`,
  },
  {
    name: "sandbox_delete_record",
    label: "Delete record (sandbox)",
    description:
      "Sandbox: simulates deleting a record. Nothing is deleted. Free, and still side-effecting so you can exercise the confirmation flow.",
    sideEffecting: true,
    icon: "trash",
    credits: 0,
    publicApi: true,
    demo: true,
    schema: z.object({
      type: z.string().describe("Record type"),
      recordId: z.string().describe("Record id"),
    }) as unknown as z.ZodType<Record<string, unknown>>,
    example: { type: "tickets", recordId: "t_51" },
    exampleResult: {
      ok: true,
      simulated: true,
      deleted: { type: "tickets", recordId: "t_51" },
      deletedAt: "2026-08-09T20:15:18.358Z",
    },
    summarize: (a) => `${str(a['type'])} · ${str(a['recordId'])}`,
  },
];

export const TOOLS_BY_NAME: Record<string, ToolContract> = Object.fromEntries(
  TOOL_CONTRACTS.map((t) => [t.name, t]),
);

/**
 * The simulated fixtures moved to a free `sandbox_` namespace. The pre-rename
 * names keep working for one release so integrations mid-flight do not break;
 * responses carry a `deprecated` pointer to the new name.
 */
export const DEPRECATED_TOOL_ALIASES: Record<string, string> = {
  lookup_crm_contact: "sandbox_lookup_crm_contact",
  list_records: "sandbox_list_records",
  send_email: "sandbox_send_email",
  update_crm_record: "sandbox_update_crm_record",
  create_payment: "sandbox_create_payment",
  delete_record: "sandbox_delete_record",
};

/** Resolves a requested tool name, following deprecated aliases. */
export function resolveTool(name: string): {
  tool: ToolContract | undefined;
  canonicalName: string;
  deprecatedAlias: string | null;
} {
  const target = DEPRECATED_TOOL_ALIASES[name];
  if (target) {
    return { tool: TOOLS_BY_NAME[target], canonicalName: target, deprecatedAlias: name };
  }
  return { tool: TOOLS_BY_NAME[name], canonicalName: name, deprecatedAlias: null };
}

export const PUBLIC_TOOLS = TOOL_CONTRACTS.filter((t) => t.publicApi);


/** Full example success envelope returned by POST /api/public/v1/tools/{name}. */
export function exampleSuccessEnvelope(tool: ToolContract, balanceBefore = 500) {
  return {
    ok: true,
    requestId: "b0e1c8a2-9f4d-4d0f-9a1e-2c5d7f8e1a30",
    tool: tool.name,
    demo: tool.demo,
    credits: { charged: tool.credits, balance: balanceBefore - tool.credits },
    result: tool.exampleResult,
  };
}

export type ToolCallStatus =
  | "pending"
  | "awaiting_confirmation"
  | "approved"
  | "denied"
  | "success"
  | "error";

export type ToolCallView = {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  status: ToolCallStatus;
  sideEffecting: boolean;
  error: string | null;
};

export type AgentStatus =
  | "streaming"
  | "awaiting_confirmation"
  | "complete"
  | "error"
  | "cancelled";

export type AgentResponse = {
  conversationId: string | null;
  messageId: string | null;
  status: AgentStatus;
  content: string;
  toolCalls: ToolCallView[];
  error: string | null;
};

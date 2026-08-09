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
  icon: "search" | "user" | "list" | "mail" | "database" | "credit-card" | "trash";
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
    name: "search_knowledge_base",
    label: "Search knowledge base",
    description:
      "Search the workspace knowledge base for internal documentation, policies and notes. Read-only.",
    sideEffecting: false,
    icon: "search",
    credits: 1,
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
    name: "lookup_crm_contact",
    label: "Look up CRM contact",
    description: "Fetch a single CRM contact by email address. Read-only.",
    sideEffecting: false,
    icon: "user",
    credits: 1,
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
    name: "list_records",
    label: "List records",
    description:
      "List records of a given type (contacts, invoices, tickets) with an optional status filter. Read-only.",
    sideEffecting: false,
    icon: "list",
    credits: 1,
    publicApi: true,
    demo: true,
    schema: z.object({
      type: z.string().describe("Record type: contacts, invoices or tickets"),
      status: z.string().nullable().describe("Optional status filter, or null"),
    }) as unknown as z.ZodType<Record<string, unknown>>,
    example: { type: "invoices", status: null },
    exampleResult: {
      ok: true,
      type: "invoices",
      count: 2,
      rows: [
        { id: "in_881", contact: "dana@northwind.io", amountCents: 420000, status: "paid" },
        { id: "in_882", contact: "priya@fernbrook.co", amountCents: 89000, status: "open" },
      ],
    },
    summarize: (a) => `${str(a['type'])}${a['status'] ? ` · ${str(a['status'])}` : ""}`,
  },
  {
    name: "send_email",
    label: "Send email",
    description:
      "Send an email to a recipient. Side-effecting: requires explicit user confirmation.",
    sideEffecting: true,
    icon: "mail",
    credits: 5,
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
    name: "update_crm_record",
    label: "Update CRM record",
    description:
      "Update fields on a CRM record. Side-effecting: requires explicit user confirmation.",
    sideEffecting: true,
    icon: "database",
    credits: 3,
    publicApi: true,
    demo: true,
    schema: z.object({
      recordId: z.string().describe("CRM record id"),
      fields: z.string().describe("JSON object of fields to update, as a string"),
    }) as unknown as z.ZodType<Record<string, unknown>>,
    example: { recordId: "c_1024", fields: '{"stage":"churn_risk","owner":"ae_12"}' },
    exampleResult: {
      ok: true,
      simulated: true,
      recordId: "c_1024",
      updatedFields: '{"stage":"churn_risk","owner":"ae_12"}',
      updatedAt: "2026-08-09T20:15:18.358Z",
    },
    summarize: (a) => str(a['recordId']),
  },
  {
    name: "create_payment",
    label: "Create payment",
    description:
      "Create a payment charge for a customer. Side-effecting: requires explicit user confirmation.",
    sideEffecting: true,
    icon: "credit-card",
    credits: 10,
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
    name: "delete_record",
    label: "Delete record",
    description:
      "Permanently delete a record. Side-effecting: requires explicit user confirmation.",
    sideEffecting: true,
    icon: "trash",
    credits: 3,
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

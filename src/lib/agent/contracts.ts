import { z } from "zod";

/**
 * Typed tool contracts shared by the agent runtime (server) and the tool
 * timeline UI (client). Handlers live in `tools.server.ts` so no provider
 * credentials or integrations ever reach the browser.
 */
export type ToolContract = {
  name: string;
  label: string;
  description: string;
  /** Side-effecting tools require explicit user confirmation before running. */
  sideEffecting: boolean;
  icon: "search" | "user" | "list" | "mail" | "database" | "credit-card" | "trash";
  schema: z.ZodType<Record<string, unknown>>;
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
    schema: z.object({
      query: z.string().describe("Natural language search query"),
    }) as unknown as z.ZodType<Record<string, unknown>>,
    summarize: (a) => `"${str(a['query'])}"`,
  },
  {
    name: "lookup_crm_contact",
    label: "Look up CRM contact",
    description: "Fetch a single CRM contact by email address. Read-only.",
    sideEffecting: false,
    icon: "user",
    schema: z.object({
      email: z.string().describe("Contact email address"),
    }) as unknown as z.ZodType<Record<string, unknown>>,
    summarize: (a) => str(a['email']),
  },
  {
    name: "list_records",
    label: "List records",
    description:
      "List records of a given type (contacts, invoices, tickets) with an optional status filter. Read-only.",
    sideEffecting: false,
    icon: "list",
    schema: z.object({
      type: z.string().describe("Record type: contacts, invoices or tickets"),
      status: z.string().nullable().describe("Optional status filter, or null"),
    }) as unknown as z.ZodType<Record<string, unknown>>,
    summarize: (a) => `${str(a['type'])}${a['status'] ? ` · ${str(a['status'])}` : ""}`,
  },
  {
    name: "send_email",
    label: "Send email",
    description:
      "Send an email to a recipient. Side-effecting: requires explicit user confirmation.",
    sideEffecting: true,
    icon: "mail",
    schema: z.object({
      to: z.string().describe("Recipient email address"),
      subject: z.string().describe("Email subject"),
      body: z.string().describe("Plain text email body"),
    }) as unknown as z.ZodType<Record<string, unknown>>,
    summarize: (a) => `${str(a['to'])} — ${str(a['subject'])}`,
  },
  {
    name: "update_crm_record",
    label: "Update CRM record",
    description:
      "Update fields on a CRM record. Side-effecting: requires explicit user confirmation.",
    sideEffecting: true,
    icon: "database",
    schema: z.object({
      recordId: z.string().describe("CRM record id"),
      fields: z.string().describe("JSON object of fields to update, as a string"),
    }) as unknown as z.ZodType<Record<string, unknown>>,
    summarize: (a) => str(a['recordId']),
  },
  {
    name: "create_payment",
    label: "Create payment",
    description:
      "Create a payment charge for a customer. Side-effecting: requires explicit user confirmation.",
    sideEffecting: true,
    icon: "credit-card",
    schema: z.object({
      customerId: z.string().describe("Customer id"),
      amountCents: z.number().describe("Amount in cents"),
      currency: z.string().describe("ISO currency code, e.g. usd"),
    }) as unknown as z.ZodType<Record<string, unknown>>,
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
    schema: z.object({
      type: z.string().describe("Record type"),
      recordId: z.string().describe("Record id"),
    }) as unknown as z.ZodType<Record<string, unknown>>,
    summarize: (a) => `${str(a['type'])} · ${str(a['recordId'])}`,
  },
];

export const TOOLS_BY_NAME: Record<string, ToolContract> = Object.fromEntries(
  TOOL_CONTRACTS.map((t) => [t.name, t]),
);

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

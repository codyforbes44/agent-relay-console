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

export async function runTool(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (name) {
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

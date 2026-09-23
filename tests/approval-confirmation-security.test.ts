import { describe, expect, it } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import { decideApprovalIntent } from "@/lib/api/approvals.server";
import {
  issueConfirmation,
  redeemConfirmation,
  revokeConfirmationsForIntent,
} from "@/lib/api/confirmations.server";
import { TOOLS_BY_NAME } from "@/lib/agent/contracts";

/**
 * Regression tests for the approval deny-bypass:
 * the 428 branch used to mint a live confirmation token for a still-pending
 * approval intent, and denying the intent never revoked it, so redeeming the
 * 428 token executed the side effect anyway.
 *
 * The fix: no token is minted until the intent is approved; tokens minted for
 * an approval flow carry intent_id; redemption verifies the intent is
 * approved; deny/expire revokes linked rows.
 */

type Row = Record<string, unknown>;

function createFakeDb() {
  const tables: Record<string, Row[]> = {
    tool_confirmations: [],
    approval_intents: [],
  };

  const pick = (row: Row, cols: string): Row => {
    if (cols.trim() === "*") return { ...row };
    const out: Row = {};
    for (const c of cols
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean))
      out[c] = row[c];
    return out;
  };

  const columnDefaults: Record<string, Row> = {
    tool_confirmations: { status: "pending" },
  };

  const runQuery = (
    table: string,
    op: "select" | "insert" | "update",
    payload: Row | null,
    cols: string,
    filters: Array<(r: Row) => boolean>,
  ) => {
    const rows = tables[table] ?? [];
    if (op === "insert") {
      const row: Row = {
        id: `row-${rows.length + 1}`,
        created_at: new Date().toISOString(),
        ...(columnDefaults[table] ?? {}),
        ...payload,
      };
      rows.push(row);
      return { data: pick(row, cols), error: null };
    }
    const matched = rows.filter((r) => filters.every((f) => f(r)));
    if (op === "update") {
      for (const r of matched) Object.assign(r, payload);
      const first = matched[0] ?? null;
      return { data: first ? pick(first, cols) : null, error: null };
    }
    const found = matched[0] ?? null;
    return { data: found ? pick(found, cols) : null, error: null };
  };

  const query = (table: string, op: "select" | "insert" | "update", payload: Row | null = null) => {
    const filters: Array<(r: Row) => boolean> = [];
    let cols = "*";
    interface FakeQuery {
      select: (c: string) => FakeQuery;
      eq: (k: string, v: unknown) => FakeQuery;
      lt: (k: string, v: unknown) => FakeQuery;
      maybeSingle: () => Promise<{ data: Row | null; error: null }>;
      single: () => Promise<{ data: Row | null; error: Error | null }>;
      then: (
        resolve: (value: { data: Row | null; error: null }) => void,
        reject: (err: unknown) => void,
      ) => Promise<void>;
    }

    const q: FakeQuery = {
      select: (c: string) => {
        cols = c;
        return q;
      },
      eq: (k: string, v: unknown) => {
        filters.push((r) => r[k] === v);
        return q;
      },
      lt: (k: string, v: unknown) => {
        filters.push((r) => String(r[k]) < String(v));
        return q;
      },
      maybeSingle: async () => runQuery(table, op, payload, cols, filters),
      single: async () => {
        const res = runQuery(table, op, payload, cols, filters);
        if (!res.data) return { data: null, error: new Error("no rows") };
        return res;
      },
      then: (
        resolve: (value: { data: Row | null; error: null }) => void,
        reject: (err: unknown) => void,
      ) => Promise.resolve(runQuery(table, op, payload, cols, filters)).then(resolve, reject),
    };
    return q;
  };

  const admin = {
    from: (table: string) => ({
      select: (c: string) => query(table, "select")["select"](c),
      insert: (payload: Row) => query(table, "insert", payload),
      update: (payload: Row) => query(table, "update", payload),
    }),
  } as unknown as SupabaseClient;

  return { admin, tables };
}

const ARGS = { to: "a@b.c", subject: "hi", body: "x" };

function seedIntent(tables: Record<string, Row[]>, overrides: Row = {}) {
  const row: Row = {
    id: "intent-1",
    org_id: "org-1",
    key_id: "key-1",
    tool_name: "gmail_send",
    tool_label: "Send email",
    args: ARGS,
    args_hash: "seed-hash",
    preview: { summary: "send email", args: ARGS },
    credits: 6,
    idempotency_key: null,
    callback_url: null,
    status: "pending",
    policy_decision: "human",
    confirmation_token: null,
    decided_by: null,
    decided_at: null,
    reason: null,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  };
  tables["approval_intents"]!.push(row);
  return row;
}

const tool = TOOLS_BY_NAME["gmail_send"];
if (!tool) throw new Error("gmail_send contract missing in test setup");

describe("approval deny-bypass", () => {
  it("a denied intent's token cannot execute the side effect", async () => {
    const { admin, tables } = createFakeDb();
    seedIntent(tables);
    // Simulate the old 428 behavior: a live token minted for a pending intent.
    const issued = await issueConfirmation(admin, {
      orgId: "org-1",
      keyId: "key-1",
      tool,
      args: ARGS,
      intentId: "intent-1",
    });

    const decided = await decideApprovalIntent(admin, {
      intentId: "intent-1",
      orgId: "org-1",
      decision: "denied",
      decidedBy: "cody",
      reason: "not now",
    });
    expect(decided.ok).toBe(true);

    const redeemed = await redeemConfirmation(admin, {
      token: issued.token,
      orgId: "org-1",
      toolName: "gmail_send",
      args: ARGS,
    });
    expect(redeemed.ok).toBe(false);
    // Either code is a correct rejection: the row was revoked on deny, and
    // the linked intent is denied. The security property is that redeem fails.
    if (!redeemed.ok)
      expect(["approval_denied", "confirmation_revoked"]).toContain(redeemed.failure.code);

    // The linked row was revoked, not left pending.
    expect(tables["tool_confirmations"]?.[0]?.["status"]).toBe("revoked");
  });

  it("a token for a still-pending intent cannot execute", async () => {
    const { admin, tables } = createFakeDb();
    seedIntent(tables);
    const issued = await issueConfirmation(admin, {
      orgId: "org-1",
      keyId: "key-1",
      tool,
      args: ARGS,
      intentId: "intent-1",
    });

    const redeemed = await redeemConfirmation(admin, {
      token: issued.token,
      orgId: "org-1",
      toolName: "gmail_send",
      args: ARGS,
    });
    expect(redeemed.ok).toBe(false);
    if (!redeemed.ok) expect(redeemed.failure.code).toBe("approval_not_approved");
  });

  it("approving the intent makes its token redeemable", async () => {
    const { admin, tables } = createFakeDb();
    seedIntent(tables);

    const decided = await decideApprovalIntent(admin, {
      intentId: "intent-1",
      orgId: "org-1",
      decision: "approved",
      decidedBy: "cody",
    });
    expect(decided.ok).toBe(true);
    if (!decided.ok) return;
    const token = decided.intent.confirmationToken;
    expect(token).toBeTruthy();

    const redeemed = await redeemConfirmation(admin, {
      token: token as string,
      orgId: "org-1",
      toolName: "gmail_send",
      args: ARGS,
    });
    expect(redeemed.ok).toBe(true);
  });

  it("classic inline tokens without an intent still redeem", async () => {
    const { admin } = createFakeDb();
    const issued = await issueConfirmation(admin, {
      orgId: "org-1",
      keyId: null,
      tool,
      args: ARGS,
    });
    const redeemed = await redeemConfirmation(admin, {
      token: issued.token,
      orgId: "org-1",
      toolName: "gmail_send",
      args: ARGS,
    });
    expect(redeemed.ok).toBe(true);
  });

  it("revoked confirmations are rejected outright", async () => {
    const { admin, tables } = createFakeDb();
    seedIntent(tables);
    const issued = await issueConfirmation(admin, {
      orgId: "org-1",
      keyId: "key-1",
      tool,
      args: ARGS,
      intentId: "intent-1",
    });
    await revokeConfirmationsForIntent(admin, "intent-1");

    const redeemed = await redeemConfirmation(admin, {
      token: issued.token,
      orgId: "org-1",
      toolName: "gmail_send",
      args: ARGS,
    });
    expect(redeemed.ok).toBe(false);
    if (!redeemed.ok) expect(redeemed.failure.code).toBe("confirmation_revoked");
  });
});

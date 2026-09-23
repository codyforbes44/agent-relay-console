import { describe, expect, it } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import {
  computePeriodGrant,
  getActiveSubscription,
  getSubscriptionByStripeId,
  grantPeriodCredits,
  markSubscriptionCanceled,
  syncSubscriptionFromStripe,
  type OrgSubscription,
} from "@/lib/api/subscriptions.server";
import { PLAN_BY_ID } from "@/lib/billing/plans";

/**
 * Monthly-plan billing: the first invoice grants the monthly allotment,
 * replays never double-grant, and renewals add rollover of the previous
 * period's unused subscription credits (capped at the plan cap).
 */

type Row = Record<string, unknown>;

function createFakeDb() {
  const tables: Record<string, Row[]> = {
    credit_ledger: [],
    org_subscriptions: [],
    subscription_periods: [],
    audit_logs: [],
  };
  const ledgerKeys = new Set<string>();
  const periodInvoices = new Set<string>();

  const pick = (row: Row, cols: string): Row => {
    if (cols.trim() === "*") return { ...row };
    const out: Row = {};
    for (const c of cols.split(",").map((s) => s.trim()).filter(Boolean)) out[c] = row[c];
    return out;
  };

  type Filter = (r: Row) => boolean;

  const query = (
    table: string,
    op: "select" | "insert" | "update" | "upsert",
    payload: Row | null = null,
    upsertConflict?: string,
  ) => {
    const filters: Filter[] = [];
    let cols = "*";
    let order: { col: string; ascending: boolean } | null = null;
    let limit: number | null = null;

    const applyUpsert = (): { data: Row | null; error: { message: string } | null } => {
      const rows = tables[table]!;
      const row: Row = { id: `row-${rows.length + 1}`, created_at: new Date().toISOString(), ...payload };
      if (table === "org_subscriptions" && upsertConflict === "stripe_subscription_id") {
        const existing = rows.find(
          (r) => r["stripe_subscription_id"] === row["stripe_subscription_id"],
        );
        if (existing) {
          Object.assign(existing, payload, { updated_at: new Date().toISOString() });
          return { data: pick(existing, cols), error: null };
        }
      }
      rows.push(row);
      return { data: pick(row, cols), error: null };
    };

    const applyInsert = (): { data: Row | null; error: { message: string } | null } => {
      const rows = tables[table]!;
      const row: Row = {
        id: `row-${rows.length + 1}`,
        created_at: new Date().toISOString(),
        ...payload,
      };
      if (table === "credit_ledger" && row["external_ref"]) {
        const key = `${row["source"]}|${row["external_ref"]}`;
        if (ledgerKeys.has(key)) {
          return { data: null, error: { message: 'duplicate key value violates unique constraint "credit_ledger_source_ref_uniq"' } };
        }
        ledgerKeys.add(key);
      }
      if (table === "subscription_periods" && row["invoice_id"]) {
        const inv = String(row["invoice_id"]);
        if (periodInvoices.has(inv)) {
          return { data: null, error: { message: 'duplicate key value violates unique constraint "subscription_periods_invoice_id_key"' } };
        }
        periodInvoices.add(inv);
      }
      rows.push(row);
      return { data: pick(row, cols), error: null };
    };

    const applySelect = () => {
      let rows = tables[table]!.filter((r) => filters.every((f) => f(r)));
      if (order) {
        rows = [...rows].sort((a, b) => {
          const av = String(a[order!.col] ?? "");
          const bv = String(b[order!.col] ?? "");
          return order!.ascending ? (av < bv ? -1 : 1) : av > bv ? -1 : 1;
        });
      }
      if (limit !== null) rows = rows.slice(0, limit);
      return { data: rows.map((r) => pick(r, cols)), error: null };
    };

    const applyUpdate = () => {
      const rows = tables[table]!.filter((r) => filters.every((f) => f(r)));
      for (const r of rows) Object.assign(r, payload);
      return { data: rows.map((r) => pick(r, cols)), error: null };
    };

    const run = () => {
      if (op === "insert") return applyInsert();
      if (op === "upsert") return applyUpsert();
      if (op === "update") return applyUpdate();
      return applySelect();
    };

    const q: Record<string, any> = {
      select: (c: string) => {
        cols = c;
        return q;
      },
      eq: (k: string, v: unknown) => {
        filters.push((r) => r[k] === v);
        return q;
      },
      lt: (k: string, v: unknown) => {
        filters.push((r) => Number(r[k]) < Number(v));
        return q;
      },
      gte: (k: string, v: unknown) => {
        filters.push((r) => String(r[k]) >= String(v));
        return q;
      },
      in: (k: string, vs: unknown[]) => {
        filters.push((r) => vs.includes(r[k]));
        return q;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        order = { col, ascending: opts?.ascending ?? true };
        return q;
      },
      limit: (n: number) => {
        limit = n;
        return q;
      },
      maybeSingle: async () => {
        const res = run();
        const rows = res.data as Row[] | null;
        const first = Array.isArray(rows) ? (rows[0] ?? null) : rows;
        return { data: first, error: res.error };
      },
      single: async () => {
        const res = await q["maybeSingle"]();
        if (!res.data) return { data: null, error: new Error("no rows") };
        return res;
      },
      then: (resolve: any, reject: any) => Promise.resolve(run()).then(resolve, reject),
    };
    return q;
  };

  const admin = {
    from: (table: string) => ({
      select: (c: string) => query(table, "select")["select"](c),
      insert: (payload: Row) => query(table, "insert", payload),
      update: (payload: Row) => query(table, "update", payload),
      upsert: (payload: Row, opts?: { onConflict?: string }) =>
        query(table, "upsert", payload, opts?.onConflict),
    }),
  } as unknown as SupabaseClient;

  return { admin, tables };
}

const plan = PLAN_BY_ID["relay_starter"]!;
if (!plan) throw new Error("relay_starter plan missing");

function seedSubscription(tables: Record<string, Row[]>): OrgSubscription {
  const row: Row = {
    id: "sub-row-1",
    org_id: "org-1",
    plan_id: plan.planId,
    stripe_customer_id: "cus_123",
    stripe_subscription_id: "sub_123",
    status: "active",
    current_period_start: new Date("2026-09-01T00:00:00Z").toISOString(),
    current_period_end: new Date("2026-10-01T00:00:00Z").toISOString(),
    cancel_at_period_end: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  tables["org_subscriptions"]!.push(row);
  return {
    id: "sub-row-1",
    orgId: "org-1",
    planId: plan.planId,
    plan,
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123",
    status: "active",
    currentPeriodStart: row["current_period_start"] as string,
    currentPeriodEnd: row["current_period_end"] as string,
    cancelAtPeriodEnd: false,
  };
}

function seedPeriod(
  tables: Record<string, Row[]>,
  overrides: Row = {},
) {
  tables["subscription_periods"]!.push({
    id: "period-1",
    subscription_id: "sub-row-1",
    org_id: "org-1",
    invoice_id: "in_prev",
    period_start: new Date("2026-09-01T00:00:00Z").toISOString(),
    period_end: new Date("2026-10-01T00:00:00Z").toISOString(),
    granted_credits: plan.monthlyCredits,
    rollover_credits: 0,
    created_at: new Date().toISOString(),
    ...overrides,
  });
}

function seedDebit(tables: Record<string, Row[]>, credits: number, at: string) {
  tables["credit_ledger"]!.push({
    id: `debit-${credits}`,
    org_id: "org-1",
    delta: -credits,
    kind: "usage",
    source: "metering",
    external_ref: `evt-${credits}-${at}`,
    created_at: at,
  });
}

const INVOICE = {
  id: "in_new",
  periodStart: new Date("2026-10-01T00:00:00Z").toISOString(),
  periodEnd: new Date("2026-11-01T00:00:00Z").toISOString(),
};

describe("monthly plan grants", () => {
  it("first invoice grants the monthly allotment with no rollover", async () => {
    const { admin, tables } = createFakeDb();
    const subscription = seedSubscription(tables);

    const result = await grantPeriodCredits(admin, { subscription, plan, invoice: INVOICE });

    expect(result.granted).toBe(true);
    expect(result.credits).toBe(plan.monthlyCredits);
    expect(result.rollover).toBe(0);
    const ledger = tables["credit_ledger"]!;
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!["delta"]).toBe(plan.monthlyCredits);
    expect(ledger[0]!["kind"]).toBe("subscription");
    expect(ledger[0]!["external_ref"]).toBe("in_new");
    expect(tables["subscription_periods"]).toHaveLength(1);
  });

  it("a replayed invoice never double-grants", async () => {
    const { admin, tables } = createFakeDb();
    const subscription = seedSubscription(tables);

    const first = await grantPeriodCredits(admin, { subscription, plan, invoice: INVOICE });
    const replay = await grantPeriodCredits(admin, { subscription, plan, invoice: INVOICE });

    expect(first.granted).toBe(true);
    expect(replay.granted).toBe(false);
    expect(tables["credit_ledger"]).toHaveLength(1);
    expect(tables["subscription_periods"]).toHaveLength(1);
  });

  it("an unspent period rolls the full cap forward", async () => {
    const db = createFakeDb();
    const subscription = seedSubscription(db.tables);
    void subscription;
    seedPeriod(db.tables);

    const { grant, rollover } = await computePeriodGrant(db.admin, {
      orgId: "org-1",
      subscriptionId: "sub-row-1",
      plan,
    });

    expect(rollover).toBe(plan.rolloverCap);
    expect(grant).toBe(plan.monthlyCredits + plan.rolloverCap);
  });

  it("partial spend rolls only the unused remainder", async () => {
    const db = createFakeDb();
    seedSubscription(db.tables);
    seedPeriod(db.tables);
    seedDebit(db.tables, 1000, new Date("2026-09-15T00:00:00Z").toISOString());

    const { grant, rollover } = await computePeriodGrant(db.admin, {
      orgId: "org-1",
      subscriptionId: "sub-row-1",
      plan,
    });

    expect(rollover).toBe(plan.monthlyCredits - 1000);
    expect(grant).toBe(plan.monthlyCredits + (plan.monthlyCredits - 1000));
  });

  it("spend beyond the grant leaves no rollover", async () => {
    const db = createFakeDb();
    seedSubscription(db.tables);
    seedPeriod(db.tables);
    seedDebit(db.tables, plan.monthlyCredits + 500, new Date("2026-09-15T00:00:00Z").toISOString());

    const { rollover, grant } = await computePeriodGrant(db.admin, {
      orgId: "org-1",
      subscriptionId: "sub-row-1",
      plan,
    });

    expect(rollover).toBe(0);
    expect(grant).toBe(plan.monthlyCredits);
  });

  it("spend before the period does not reduce rollover", async () => {
    const db = createFakeDb();
    seedSubscription(db.tables);
    seedPeriod(db.tables);
    // Debit landed before the granted period started: must be ignored.
    seedDebit(db.tables, 2000, new Date("2026-08-15T00:00:00Z").toISOString());

    const { rollover } = await computePeriodGrant(db.admin, {
      orgId: "org-1",
      subscriptionId: "sub-row-1",
      plan,
    });

    expect(rollover).toBe(plan.rolloverCap);
  });
});

describe("subscription lifecycle", () => {
  it("syncs a new subscription from Stripe", async () => {
    const { admin } = createFakeDb();
    const stripeSub = {
      id: "sub_123",
      customer: "cus_123",
      status: "active",
      metadata: { orgId: "org-1", userId: "user-1", planId: plan.planId },
      items: {
        data: [{ current_period_start: 1759276800, current_period_end: 1761955200 }],
      },
      cancel_at_period_end: false,
    } as unknown as Stripe.Subscription;

    await syncSubscriptionFromStripe(admin, stripeSub);

    const found = await getSubscriptionByStripeId(admin, "sub_123");
    expect(found?.orgId).toBe("org-1");
    expect(found?.planId).toBe(plan.planId);
    expect(found?.plan?.name).toBe("Starter");
    expect(found?.status).toBe("active");

    const active = await getActiveSubscription(admin, "org-1");
    expect(active?.stripeSubscriptionId).toBe("sub_123");
  });

  it("canceled subscriptions stop counting as active", async () => {
    const db = createFakeDb();
    seedSubscription(db.tables);

    expect(await getActiveSubscription(db.admin, "org-1")).not.toBeNull();
    await markSubscriptionCanceled(db.admin, "sub_123");
    expect(await getActiveSubscription(db.admin, "org-1")).toBeNull();
  });
});

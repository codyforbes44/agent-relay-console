import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyWebhookEvent } from "@/lib/api/stripe.server";

const SECRET = "whsec_test_secret_for_unit_tests";

const eventPayload = JSON.stringify({
  id: "evt_test_1",
  object: "event",
  type: "checkout.session.completed",
  livemode: false,
  data: {
    object: {
      id: "cs_test_123",
      object: "checkout.session",
      payment_status: "paid",
      amount_total: 900,
      currency: "usd",
      metadata: { orgId: "org-1", userId: "user-1", packId: "credits_1k", credits: "1000" },
    },
  },
});

// generateTestHeaderString signs locally; no network or real account involved.
const stripe = new Stripe("sk_test_dummy_key_never_used");

function signedHeader(payload: string, secret = SECRET, timestamp?: number) {
  return stripe.webhooks.generateTestHeaderString({
    payload,
    secret,
    ...(timestamp ? { timestamp } : {}),
  });
}

describe("verifyWebhookEvent", () => {
  beforeEach(() => {
    process.env["STRIPE_SECRET_KEY"] = "sk_test_dummy_key_never_used";
    process.env["STRIPE_WEBHOOK_SECRET"] = SECRET;
  });

  afterEach(() => {
    delete process.env["STRIPE_SECRET_KEY"];
    delete process.env["STRIPE_WEBHOOK_SECRET"];
  });

  it("accepts a correctly signed payload and parses the event", () => {
    const event = verifyWebhookEvent(eventPayload, signedHeader(eventPayload));
    expect(event.type).toBe("checkout.session.completed");
    const session = event.data.object as Stripe.Checkout.Session;
    expect(session.metadata?.["credits"]).toBe("1000");
  });

  it("rejects a tampered payload", () => {
    const tampered = eventPayload.replace('"credits":"1000"', '"credits":"999000"');
    expect(tampered).not.toBe(eventPayload);
    expect(() => verifyWebhookEvent(tampered, signedHeader(eventPayload))).toThrow();
  });

  it("rejects a signature made with the wrong secret", () => {
    const header = signedHeader(eventPayload, "whsec_attacker_secret");
    expect(() => verifyWebhookEvent(eventPayload, header)).toThrow();
  });

  it("rejects a stale timestamp outside the tolerance window", () => {
    const stale = Math.floor(Date.now() / 1000) - 60 * 60;
    const header = signedHeader(eventPayload, SECRET, stale);
    expect(() => verifyWebhookEvent(eventPayload, header)).toThrow();
  });

  it("fails closed when the webhook secret is not configured", () => {
    delete process.env["STRIPE_WEBHOOK_SECRET"];
    expect(() => verifyWebhookEvent(eventPayload, signedHeader(eventPayload))).toThrow(
      /not configured/,
    );
  });
});

/* ------------------------------------------------------------------ */
/* Handler behaviour: routing, crediting, and idempotency.             */
/* ------------------------------------------------------------------ */

type Insert = { table: string; row: Record<string, unknown> };

/**
 * Minimal fake of the admin Supabase client. It records every insert and
 * replays the real unique index on credit_ledger (source, external_ref) so
 * replay protection is exercised, not assumed.
 */
function makeFakeAdmin(options: { purchase?: Record<string, unknown> | null } = {}) {
  const inserts: Insert[] = [];
  const ledgerRefs = new Set<string>();
  let failNextLedgerInsert: string | null = null;

  const client = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          if (table === "credit_ledger") {
            if (failNextLedgerInsert) {
              const message = failNextLedgerInsert;
              failNextLedgerInsert = null;
              return Promise.resolve({ error: { message } });
            }
            const ref = `${String(row["source"])}:${String(row["external_ref"])}`;
            if (ledgerRefs.has(ref)) {
              return Promise.resolve({
                error: {
                  message:
                    'duplicate key value violates unique constraint "idx_credit_ledger_external_ref"',
                },
              });
            }
            ledgerRefs.add(ref);
          }
          inserts.push({ table, row });
          return Promise.resolve({ error: null });
        },
        select() {
          return {
            eq() {
              return {
                maybeSingle: () =>
                  Promise.resolve({ data: options.purchase ?? null, error: null }),
              };
            },
          };
        },
      };
    },
  };

  return {
    inserts,
    client,
    failLedgerInsertOnce(message: string) {
      failNextLedgerInsert = message;
    },
    of(table: string) {
      return inserts.filter((i) => i.table === table);
    },
  };
}

let fake = makeFakeAdmin();

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return fake.client;
  },
}));

const sessionLookup = vi.fn();
const refundLookup = vi.fn();

vi.mock("@/lib/api/stripe.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/stripe.server")>();
  return {
    ...actual,
    findSessionByPaymentIntent: (id: string) => sessionLookup(id),
    listChargeRefunds: (id: string) => refundLookup(id),
  };
});

const { handleStripeWebhook } = await import("@/lib/api/stripe-webhook.server");

function post(payload: string, header?: string | null) {
  const headers = new Headers({ "content-type": "application/json" });
  if (header !== null) headers.set("stripe-signature", header ?? signedHeader(payload));
  return new Request("https://3bi.ai/api/public/stripe/webhook", {
    method: "POST",
    headers,
    body: payload,
  });
}

function checkoutEvent(overrides: {
  sessionId?: string;
  paymentStatus?: string;
  metadata?: Record<string, string> | undefined;
  livemode?: boolean;
}) {
  return JSON.stringify({
    id: `evt_${overrides.sessionId ?? "cs_test_123"}`,
    object: "event",
    type: "checkout.session.completed",
    livemode: overrides.livemode ?? false,
    data: {
      object: {
        id: overrides.sessionId ?? "cs_test_123",
        object: "checkout.session",
        payment_status: overrides.paymentStatus ?? "paid",
        amount_total: 900,
        currency: "usd",
        metadata:
          overrides.metadata === undefined
            ? { orgId: "org-1", userId: "user-1", packId: "credits_1k", credits: "1000" }
            : overrides.metadata,
      },
    },
  });
}

describe("handleStripeWebhook", () => {
  beforeEach(() => {
    process.env["STRIPE_SECRET_KEY"] = "sk_test_dummy_key_never_used";
    process.env["STRIPE_WEBHOOK_SECRET"] = SECRET;
    fake = makeFakeAdmin();
    sessionLookup.mockReset();
    refundLookup.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env["STRIPE_SECRET_KEY"];
    delete process.env["STRIPE_WEBHOOK_SECRET"];
    vi.restoreAllMocks();
  });

  it("returns 400 when the stripe-signature header is missing", async () => {
    const res = await handleStripeWebhook(post(eventPayload, null));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "missing signature" });
    expect(fake.inserts).toHaveLength(0);
  });

  it("returns 400 for an invalid signature and never touches the ledger", async () => {
    const res = await handleStripeWebhook(post(eventPayload, "t=1,v1=deadbeef"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid signature" });
    expect(fake.inserts).toHaveLength(0);
  });

  it("credits the ledger, records the purchase, and writes an audit log", async () => {
    const payload = checkoutEvent({});
    const res = await handleStripeWebhook(post(payload));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true, credited: true });

    const ledger = fake.of("credit_ledger");
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.row).toMatchObject({
      org_id: "org-1",
      delta: 1000,
      kind: "topup",
      source: "stripe",
      external_ref: "cs_test_123",
    });

    expect(fake.of("credit_purchases")[0]!.row).toMatchObject({
      org_id: "org-1",
      transaction_id: "cs_test_123",
      environment: "test",
      credits: 1000,
      amount_cents: 900,
    });

    expect(fake.of("audit_logs")[0]!.row).toMatchObject({ action: "credits.purchased" });
  });

  it("marks live events as the live environment", async () => {
    const payload = checkoutEvent({ sessionId: "cs_live_1", livemode: true });
    await handleStripeWebhook(post(payload));
    expect(fake.of("credit_purchases")[0]!.row).toMatchObject({ environment: "live" });
  });

  it("credits exactly once when the same session is replayed", async () => {
    const payload = checkoutEvent({});

    const first = await handleStripeWebhook(post(payload));
    await expect(first.json()).resolves.toEqual({ received: true, credited: true });

    const second = await handleStripeWebhook(post(payload));
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toEqual({ received: true, credited: false });

    expect(fake.of("credit_ledger")).toHaveLength(1);
    expect(fake.of("credit_purchases")).toHaveLength(1);
    expect(fake.of("audit_logs")).toHaveLength(1);
  });

  it("returns 500 on a real ledger write failure so Stripe retries", async () => {
    fake.failLedgerInsertOnce("connection terminated unexpectedly");
    const res = await handleStripeWebhook(post(checkoutEvent({})));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "ledger write failed" });
    expect(fake.of("credit_purchases")).toHaveLength(0);
  });

  it("does not credit when the session is not paid yet", async () => {
    const payload = checkoutEvent({ sessionId: "cs_unpaid", paymentStatus: "unpaid" });
    const res = await handleStripeWebhook(post(payload));
    await expect(res.json()).resolves.toEqual({ received: true, ignored: "not paid yet" });
    expect(fake.inserts).toHaveLength(0);
  });

  it("does not credit when metadata is missing or corrupted", async () => {
    const noOrg = checkoutEvent({ sessionId: "cs_nometa", metadata: { credits: "1000" } });
    await expect((await handleStripeWebhook(post(noOrg))).json()).resolves.toEqual({
      received: true,
      ignored: "bad metadata",
    });

    const badCredits = checkoutEvent({
      sessionId: "cs_badcredits",
      metadata: { orgId: "org-1", credits: "not-a-number" },
    });
    await expect((await handleStripeWebhook(post(badCredits))).json()).resolves.toEqual({
      received: true,
      ignored: "bad metadata",
    });

    const zeroCredits = checkoutEvent({
      sessionId: "cs_zero",
      metadata: { orgId: "org-1", credits: "0" },
    });
    await expect((await handleStripeWebhook(post(zeroCredits))).json()).resolves.toEqual({
      received: true,
      ignored: "bad metadata",
    });

    expect(fake.inserts).toHaveLength(0);
  });

  it("acknowledges and ignores unrelated event types", async () => {
    const payload = JSON.stringify({
      id: "evt_other",
      object: "event",
      type: "payment_intent.created",
      livemode: false,
      data: { object: { id: "pi_1", object: "payment_intent" } },
    });
    const res = await handleStripeWebhook(post(payload));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      received: true,
      ignored: "payment_intent.created",
    });
    expect(fake.inserts).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Refund clawback.                                                     */
/* ------------------------------------------------------------------ */

function refundEvent(chargeId = "ch_1") {
  return JSON.stringify({
    id: `evt_${chargeId}`,
    object: "event",
    type: "charge.refunded",
    livemode: false,
    data: {
      object: { id: chargeId, object: "charge", amount: 900, payment_intent: "pi_1" },
    },
  });
}

describe("handleStripeWebhook — charge.refunded", () => {
  beforeEach(() => {
    process.env["STRIPE_SECRET_KEY"] = "sk_test_dummy_key_never_used";
    process.env["STRIPE_WEBHOOK_SECRET"] = SECRET;
    sessionLookup.mockReset();
    refundLookup.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env["STRIPE_SECRET_KEY"];
    delete process.env["STRIPE_WEBHOOK_SECRET"];
    vi.restoreAllMocks();
  });

  it("removes all credits on a full refund", async () => {
    fake = makeFakeAdmin({
      purchase: { org_id: "org-1", user_id: "user-1", credits: 1000, amount_cents: 900 },
    });
    sessionLookup.mockResolvedValue({ id: "cs_test_123" });
    refundLookup.mockResolvedValue([{ id: "re_1", amount: 900, status: "succeeded" }]);

    const res = await handleStripeWebhook(post(refundEvent()));
    await expect(res.json()).resolves.toEqual({ received: true, creditsRemoved: 1000 });

    expect(fake.of("credit_ledger")[0]!.row).toMatchObject({
      delta: -1000,
      kind: "refund",
      source: "stripe",
      external_ref: "re_1",
    });
    expect(fake.of("audit_logs")[0]!.row).toMatchObject({ action: "credits.refunded" });
  });

  it("removes a proportional share on a partial refund", async () => {
    fake = makeFakeAdmin({
      purchase: { org_id: "org-1", user_id: "user-1", credits: 1000, amount_cents: 900 },
    });
    sessionLookup.mockResolvedValue({ id: "cs_test_123" });
    refundLookup.mockResolvedValue([{ id: "re_half", amount: 450, status: "succeeded" }]);

    const res = await handleStripeWebhook(post(refundEvent()));
    await expect(res.json()).resolves.toEqual({ received: true, creditsRemoved: 500 });
    expect(fake.of("credit_ledger")[0]!.row).toMatchObject({ delta: -500 });
  });

  it("does not double-deduct when charge.refunded is delivered twice", async () => {
    fake = makeFakeAdmin({
      purchase: { org_id: "org-1", user_id: "user-1", credits: 1000, amount_cents: 900 },
    });
    sessionLookup.mockResolvedValue({ id: "cs_test_123" });
    refundLookup.mockResolvedValue([{ id: "re_1", amount: 900, status: "succeeded" }]);

    await handleStripeWebhook(post(refundEvent()));
    const second = await handleStripeWebhook(post(refundEvent()));

    await expect(second.json()).resolves.toEqual({ received: true, creditsRemoved: 0 });
    expect(fake.of("credit_ledger")).toHaveLength(1);
    expect(fake.of("audit_logs")).toHaveLength(1);
  });

  it("only claws back the new refund when a second partial refund arrives", async () => {
    fake = makeFakeAdmin({
      purchase: { org_id: "org-1", user_id: "user-1", credits: 1000, amount_cents: 900 },
    });
    sessionLookup.mockResolvedValue({ id: "cs_test_123" });

    refundLookup.mockResolvedValue([{ id: "re_a", amount: 450, status: "succeeded" }]);
    await handleStripeWebhook(post(refundEvent()));

    refundLookup.mockResolvedValue([
      { id: "re_a", amount: 450, status: "succeeded" },
      { id: "re_b", amount: 450, status: "succeeded" },
    ]);
    const second = await handleStripeWebhook(post(refundEvent()));

    await expect(second.json()).resolves.toEqual({ received: true, creditsRemoved: 500 });
    expect(fake.of("credit_ledger").map((i) => i.row["external_ref"])).toEqual(["re_a", "re_b"]);
  });

  it("ignores pending refunds", async () => {
    fake = makeFakeAdmin({
      purchase: { org_id: "org-1", user_id: "user-1", credits: 1000, amount_cents: 900 },
    });
    sessionLookup.mockResolvedValue({ id: "cs_test_123" });
    refundLookup.mockResolvedValue([{ id: "re_pending", amount: 900, status: "pending" }]);

    const res = await handleStripeWebhook(post(refundEvent()));
    await expect(res.json()).resolves.toEqual({ received: true, creditsRemoved: 0 });
    expect(fake.of("credit_ledger")).toHaveLength(0);
  });

  it("acknowledges a refund for a charge that is not one of our purchases", async () => {
    fake = makeFakeAdmin({ purchase: null });
    sessionLookup.mockResolvedValue({ id: "cs_unknown" });
    refundLookup.mockResolvedValue([]);

    const res = await handleStripeWebhook(post(refundEvent()));
    await expect(res.json()).resolves.toEqual({
      received: true,
      ignored: "no recorded purchase",
    });
    expect(fake.inserts).toHaveLength(0);
  });
});

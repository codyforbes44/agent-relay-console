import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

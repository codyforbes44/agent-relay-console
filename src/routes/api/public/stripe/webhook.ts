import { createFileRoute } from "@tanstack/react-router";

import { handleStripeWebhook } from "@/lib/api/stripe-webhook.server";

/**
 * Stripe webhook endpoint. Lives under /api/public/ so Stripe can reach it
 * without site auth; every request is authenticated by verifying the
 * `stripe-signature` header against the raw body inside the handler.
 */
export const Route = createFileRoute("/api/public/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => handleStripeWebhook(request),
    },
  },
});

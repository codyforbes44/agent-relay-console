import { createFileRoute } from "@tanstack/react-router";

import { json, preflight } from "@/lib/api/catalog.server";
import { pricingDocument } from "@/lib/api/pricing.server";

/** Machine-readable USD pricing for every metered tool and credit pack. */
export const Route = createFileRoute("/api/public/v1/pricing")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request }) => json(pricingDocument(new URL(request.url).origin)),
    },
  },
});

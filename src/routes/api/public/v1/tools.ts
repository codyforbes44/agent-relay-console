import { createFileRoute } from "@tanstack/react-router";

import { catalog, json, preflight } from "@/lib/api/catalog.server";

export const Route = createFileRoute("/api/public/v1/tools")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request }) => json(catalog(new URL(request.url).origin)),
    },
  },
});

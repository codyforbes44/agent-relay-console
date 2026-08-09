import { createFileRoute } from "@tanstack/react-router";

import { json, openApiDocument, preflight } from "@/lib/api/catalog.server";

export const Route = createFileRoute("/api/public/v1/openapi.json")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request }) => json(openApiDocument(new URL(request.url).origin)),
    },
  },
});

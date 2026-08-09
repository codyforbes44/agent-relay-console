import { createFileRoute } from "@tanstack/react-router";

import { PUBLIC_TOOLS } from "@/lib/agent/contracts";
import { json, preflight } from "@/lib/api/catalog.server";

/** Machine-readable discovery document for autonomous agents. */
export const Route = createFileRoute("/.well-known/agent-manifest.json")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        return json({
          schema_version: "v1",
          name_for_model: "relay_tools",
          name_for_human: "Relay Agent Tool API",
          description_for_model:
            "Metered tools for autonomous agents: knowledge search, CRM lookups, record listing, email, CRM writes, payments and deletions. Authenticate with a workspace API key; each call costs credits.",
          description_for_human: "Pay-per-call tools for AI agents.",
          auth: { type: "bearer", signup_url: `${origin}/auth` },
          api: { type: "openapi", url: `${origin}/api/public/v1/openapi.json` },
          catalog_url: `${origin}/api/public/v1/tools`,
          mcp: { transport: "streamable-http", url: `${origin}/mcp`, auth: "oauth2.1" },
          docs_url: `${origin}/docs`,

          tool_names: PUBLIC_TOOLS.map((t) => t.name),
        });
      },
    },
  },
});

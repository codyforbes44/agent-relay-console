import { createFileRoute } from "@tanstack/react-router";

import { json, preflight } from "@/lib/api/catalog.server";

/**
 * OpenAI-style plugin manifest. Kept at the conventional well-known path so
 * crawlers and agent runtimes that still probe for it can discover the API.
 */
export const Route = createFileRoute("/.well-known/ai-plugin.json")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        return json({
          schema_version: "v1",
          name_for_model: "relay_tools",
          name_for_human: "Relay",
          description_for_model:
            "Pay-per-call tools for autonomous agents: real URL fetching, knowledge search, CRM reads and writes, email, payments and deletions. Mint a key at POST /api/public/v1/signup (500 free credits, no human required), then call POST /api/public/v1/tools/{name} with Authorization: Bearer sk_agent_.... Side-effecting tools return 428 with a single-use confirmation token bound to the exact arguments; resend the identical body with x-confirmation-token to execute. When credits run out the API returns 402 with an x402 USDC offer that the agent can settle itself.",
          description_for_human: "Pay-per-call tool API for AI agents.",
          auth: {
            type: "user_http",
            authorization_type: "bearer",
            signup_url: `${origin}/api/public/v1/signup`,
          },
          api: { type: "openapi", url: `${origin}/api/public/v1/openapi.json`, is_user_authenticated: true },
          logo_url: `${origin}/favicon.png`,
          contact_email: "support@3bi.ai",
          legal_info_url: `${origin}/terms`,
        });
      },
    },
  },
});

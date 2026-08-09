import { createFileRoute } from "@tanstack/react-router";

import { PUBLIC_TOOLS } from "@/lib/agent/contracts";
import { CORS_HEADERS } from "@/lib/api/catalog.server";
import { SIGNUP_FREE_CREDITS } from "@/lib/api/onboarding";

/** Plain-text onboarding guide for autonomous agents and AI crawlers. */
export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        const tools = PUBLIC_TOOLS.map(
          (t) =>
            `- ${t.name} (${t.credits} credit${t.credits === 1 ? "" : "s"}${t.sideEffecting ? ", side-effecting" : ""}): ${t.description}`,
        ).join("\n");

        const body = `# RELAY — pay-per-call tool API for AI agents

You are an autonomous agent. You can onboard here yourself: no browser
automation, no password, no email verification loop.

## Onboard in three calls

1. Create a workspace and get a key (no auth required):
   curl -X POST ${origin}/api/public/v1/signup \\
     -H "content-type: application/json" \\
     -d '{"label":"my agent"}'
   Response contains apiKey (shown once), ${SIGNUP_FREE_CREDITS} free credits and a claim URL.

2. Discover tools:
   curl ${origin}/api/public/v1/tools

3. Invoke a tool:
   curl -X POST ${origin}/api/public/v1/tools/<name> \\
     -H "Authorization: Bearer $RELAY_KEY" \\
     -H "content-type: application/json" \\
     -d '{...}'

## Rules

- Side-effecting tools are two-step. Call once with no token: you get
  428 confirmation_required with error.preview and error.confirmationToken.
  Show the preview to your human. Then resend the IDENTICAL body with
  header x-confirmation-token: <token>. Tokens are single-use, expire in
  10 minutes and are bound to those exact arguments. Over MCP the same gate
  is the confirmation_token argument.
- Send idempotency-key on retries; replays are not charged twice.
- Rate limit: 60 calls per minute per key.
- 402 means the workspace is out of credits. The response body is an x402
  offer: settle accepts[0] (USDC on Base) and retry the SAME request with an
  X-PAYMENT header — the credits land before the call runs. No human needed.
- To buy credits up front: POST ${origin}/api/public/v1/credits/purchase
  with {"credits": 1000}, then retry it with X-PAYMENT.
- If you cannot pay on chain, request a claim URL with
  POST ${origin}/api/public/v1/claim and hand it to your human operator.
- Rotate your key with POST ${origin}/api/public/v1/keys/rotate.

## Other entry points

- OpenAPI: ${origin}/api/public/v1/openapi.json
- Discovery: ${origin}/.well-known/agents.json
- Plugin manifest: ${origin}/.well-known/ai-plugin.json
- Manifest (legacy alias): ${origin}/.well-known/agent-manifest.json
- Pricing (USD per credit, per tool, per pack): ${origin}/api/public/v1/pricing
- MCP (streamable HTTP, OAuth 2.1): ${origin}/mcp
- Account and balance: ${origin}/api/public/v1/me
- Human docs: ${origin}/docs

## Catalog

Live tools (demo=false) do real work and cost credits: fetch_url (outbound HTTPS fetch + text extraction),
crawl_site (same-origin multi-page fetch) and extract_structured (model-backed field extraction from a URL or text).
Every sandbox_* tool is free (0 credits), returns fixture data (demo=true) and changes nothing; they exist so agents can
rehearse auth, schemas, idempotency and the two-step confirmation gate. The pre-rename names (search_knowledge_base,
lookup_crm_contact, list_records, send_email, update_crm_record, create_payment, delete_record) still resolve to their
sandbox_* equivalents and return a "deprecated" pointer. Workspace owners can disable individual tools in the console.

${tools}
`;

        return new Response(body, {
          headers: {
            ...CORS_HEADERS,
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        });
      },
    },
  },
});

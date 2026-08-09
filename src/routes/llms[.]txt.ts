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

- Side-effecting tools require the header: x-confirm-side-effects: true
- Send idempotency-key on retries; replays are not charged twice.
- Rate limit: 60 calls per minute per key.
- 402 insufficient_credits means the workspace is out of credits. Request a
  claim URL with POST ${origin}/api/public/v1/claim and give it to your human
  operator, who signs in and buys credits.
- Rotate your key with POST ${origin}/api/public/v1/keys/rotate.

## Other entry points

- OpenAPI: ${origin}/api/public/v1/openapi.json
- Manifest: ${origin}/.well-known/agent-manifest.json
- MCP (streamable HTTP, OAuth 2.1): ${origin}/mcp
- Account and balance: ${origin}/api/public/v1/me
- Human docs: ${origin}/docs

## Tools

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

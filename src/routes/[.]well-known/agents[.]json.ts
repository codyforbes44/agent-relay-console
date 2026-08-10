import { createFileRoute } from "@tanstack/react-router";

import { PUBLIC_TOOLS } from "@/lib/agent/contracts";
import { json, preflight } from "@/lib/api/catalog.server";
import { pricingDocument } from "@/lib/api/pricing.server";

/**
 * Agent-native discovery document: one fetch tells an autonomous client what
 * this service does, how to get a key, what each call costs and how to pay.
 */
export const Route = createFileRoute("/.well-known/agents.json")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        const pricing = pricingDocument(origin);
        return json({
          schema_version: "2026-08-09",
          name: "Relay",
          summary:
            "Pay-per-call tool API for AI agents. Machine signup, metered credits, x402 settlement.",
          homepage: origin,
          docs: `${origin}/docs`,
          llms_txt: `${origin}/llms.txt`,
          openapi: `${origin}/api/public/v1/openapi.json`,
          catalog: `${origin}/api/public/v1/tools`,
          pricing_url: `${origin}/api/public/v1/pricing`,
          manifests: {
            agent_manifest: `${origin}/.well-known/agent-manifest.json`,
            ai_plugin: `${origin}/.well-known/ai-plugin.json`,
          },
          interfaces: [
            { protocol: "rest", url: `${origin}/api/public/v1`, auth: "bearer" },
            {
              protocol: "mcp",
              transport: "streamable-http",
              url: `${origin}/mcp`,
              auth: "oauth2.1",
            },
          ],
          onboarding: {
            machine: { url: `${origin}/api/public/v1/signup`, method: "POST", free_credits: 500 },
            human_handoff: { url: `${origin}/api/public/v1/claim`, method: "POST" },
            rotate: { url: `${origin}/api/public/v1/keys/rotate`, method: "POST" },
          },
          payments: {
            unit: "credit",
            usd_per_credit: pricing.usdPerCredit,
            protocols: ["x402"],
            asset: "USDC",
            networks: ["base"],
            purchase_url: `${origin}/api/public/v1/credits/purchase`,
            human_checkout_url: `${origin}/pricing`,
          },
          safety: {
            confirmation:
              "Side-effecting tools require a two-step flow: an unconfirmed call returns 428 with a preview and a single-use token bound to the exact arguments; resend the identical body with x-confirmation-token to execute.",
            idempotency_header: "idempotency-key",
          },
          tools: PUBLIC_TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            side_effecting: t.sideEffecting,
            demo: t.demo,
            credits: t.credits,
            usd_per_call: pricing.tools.find((p) => p.name === t.name)?.usdPerCall ?? null,
            invoke_url: `${origin}/api/public/v1/tools/${t.name}`,
          })),
        });
      },
    },
  },
});

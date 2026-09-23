import { createFileRoute } from "@tanstack/react-router";

import { apiError, json, preflight } from "@/lib/api/catalog.server";
import { authenticateAgentKey, readBearer } from "@/lib/api/keys.server";
import { buildAuthorizeUrl } from "@/lib/api/oauth.server";

/**
 * Starts the OAuth dance for the calling workspace. Returns an authorization
 * URL for a HUMAN to open — the agent shows it to its operator, the operator
 * consents at the provider, and the provider redirects to /oauth/callback.
 */
export const Route = createFileRoute("/api/public/v1/oauth/$provider/authorize")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),

      POST: async ({ params, request }) => {
        const raw = readBearer(request);
        if (!raw)
          return apiError(401, "missing_api_key", "Provide Authorization: Bearer sk_agent_...");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const identity = await authenticateAgentKey(supabaseAdmin, raw);
        if (!identity) return apiError(401, "invalid_api_key", "API key is invalid or revoked");
        if (!identity.scopes.includes("tools:invoke")) {
          return apiError(403, "insufficient_scope", "This key cannot invoke tools");
        }

        const origin = new URL(request.url).origin;
        try {
          const { url, expiresAt } = await buildAuthorizeUrl(supabaseAdmin, {
            provider: params.provider,
            orgId: identity.orgId,
            keyId: identity.keyId,
            origin,
          });
          return json({
            ok: true,
            provider: params.provider,
            authorize_url: url,
            expires_at: expiresAt,
            instructions:
              "Have your human operator open authorize_url and approve access. " +
              "Tokens are stored encrypted on your workspace; the agent never sees them. " +
              "Connected tools (gmail_send, slack_post_message, github_create_issue) work once connected.",
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : "Authorization could not be started";
          if (message.startsWith("oauth_provider_unknown:")) {
            return apiError(
              404,
              "oauth_provider_unknown",
              `No such OAuth provider: ${params.provider}. See GET /api/public/v1/oauth/providers.`,
            );
          }
          if (message.startsWith("oauth_provider_not_configured:")) {
            return apiError(
              502,
              "oauth_provider_not_configured",
              "This provider is not configured on RELAY yet.",
            );
          }
          return apiError(500, "oauth_authorize_failed", message);
        }
      },
    },
  },
});

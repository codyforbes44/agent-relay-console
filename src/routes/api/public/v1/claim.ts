import { createFileRoute } from "@tanstack/react-router";

import { apiError, json, preflight } from "@/lib/api/catalog.server";
import { authenticateAgentKey, readBearer } from "@/lib/api/keys.server";
import { CLAIM_TOKEN_TTL_MINUTES } from "@/lib/api/onboarding";
import { createClaimToken } from "@/lib/api/signup.server";

/**
 * Mints a fresh claim URL for the authenticated key's workspace so the agent
 * can hand ownership (and billing) to a human.
 */
export const Route = createFileRoute("/api/public/v1/claim")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request }) => {
        const raw = readBearer(request);
        if (!raw) return apiError(401, "missing_api_key", "Provide Authorization: Bearer sk_agent_...");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const identity = await authenticateAgentKey(supabaseAdmin, raw);
        if (!identity) return apiError(401, "invalid_api_key", "API key is invalid or revoked");

        const { data: org } = await supabaseAdmin
          .from("organizations")
          .select("claimed_at")
          .eq("id", identity.orgId)
          .maybeSingle();
        if (org?.claimed_at) {
          return apiError(409, "already_claimed", "This workspace already has a human owner");
        }

        const origin = new URL(request.url).origin;
        try {
          const claim = await createClaimToken(supabaseAdmin, identity.orgId, origin);
          return json({
            ok: true,
            claim: { url: claim.url, expiresAt: claim.expiresAt, ttlMinutes: CLAIM_TOKEN_TTL_MINUTES },
            instructions:
              "Show this URL to your operator. After they sign in, the workspace is theirs and credits can be purchased.",
          });
        } catch {
          return apiError(500, "claim_failed", "Could not create a claim link right now");
        }
      },
    },
  },
});

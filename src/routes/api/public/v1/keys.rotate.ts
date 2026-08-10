import { createFileRoute } from "@tanstack/react-router";

import { apiError, json, preflight } from "@/lib/api/catalog.server";
import { authenticateAgentKey, readBearer } from "@/lib/api/keys.server";
import { KEY_ROTATION_OVERLAP_MINUTES } from "@/lib/api/onboarding";
import { rotateAgentKey } from "@/lib/api/signup.server";

/** Rotates the calling key. The old key keeps working for a short overlap. */
export const Route = createFileRoute("/api/public/v1/keys/rotate")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request }) => {
        const raw = readBearer(request);
        if (!raw)
          return apiError(401, "missing_api_key", "Provide Authorization: Bearer sk_agent_...");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const identity = await authenticateAgentKey(supabaseAdmin, raw);
        if (!identity) return apiError(401, "invalid_api_key", "API key is invalid or revoked");

        try {
          const rotated = await rotateAgentKey(supabaseAdmin, identity.orgId, identity.keyId);
          return json({
            ok: true,
            apiKey: rotated.apiKey,
            keyId: rotated.keyId,
            previousKey: {
              id: identity.keyId,
              revokedAt: rotated.previousKeyRevokedAt,
              overlapMinutes: KEY_ROTATION_OVERLAP_MINUTES,
            },
            notice: "Store apiKey now — it is shown once.",
          });
        } catch {
          return apiError(500, "rotate_failed", "Could not rotate this key right now");
        }
      },
    },
  },
});

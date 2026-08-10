import { createFileRoute } from "@tanstack/react-router";

import { apiError, json, preflight } from "@/lib/api/catalog.server";
import { authenticateAgentKey, readBearer } from "@/lib/api/keys.server";
import { getBalance, RATE_LIMIT_PER_MINUTE } from "@/lib/api/metering.server";
import { SIGNUP_FREE_CREDITS } from "@/lib/api/onboarding";

export const Route = createFileRoute("/api/public/v1/me")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request }) => {
        const raw = readBearer(request);
        if (!raw)
          return apiError(401, "missing_api_key", "Provide Authorization: Bearer sk_agent_...");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const identity = await authenticateAgentKey(supabaseAdmin, raw);
        if (!identity) return apiError(401, "invalid_api_key", "API key is invalid or revoked");

        const origin = new URL(request.url).origin;
        const [balance, usage, org] = await Promise.all([
          getBalance(supabaseAdmin, identity.orgId),
          supabaseAdmin
            .from("usage_events")
            .select("id", { count: "exact", head: true })
            .eq("org_id", identity.orgId),
          supabaseAdmin
            .from("organizations")
            .select("origin, claimed_at")
            .eq("id", identity.orgId)
            .maybeSingle(),
        ]);

        const claimed = Boolean(org.data?.claimed_at);

        return json({
          ok: true,
          orgId: identity.orgId,
          scopes: identity.scopes,
          credits: {
            balance,
            freeGrant: SIGNUP_FREE_CREDITS,
            topUpUrl: claimed ? `${origin}/billing` : `${origin}/api/public/v1/claim`,
          },
          workspace: {
            origin: org.data?.origin ?? "human",
            claimed,
            claimUrl: claimed ? null : `${origin}/api/public/v1/claim`,
          },
          usage: { totalCalls: usage.count ?? 0 },
          rateLimit: { perMinute: RATE_LIMIT_PER_MINUTE },
        });
      },
    },
  },
});

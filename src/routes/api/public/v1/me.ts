import { createFileRoute } from "@tanstack/react-router";

import { apiError, json, preflight } from "@/lib/api/catalog.server";
import { authenticateAgentKey, readBearer } from "@/lib/api/keys.server";
import { getBalance, RATE_LIMIT_PER_MINUTE } from "@/lib/api/metering.server";

export const Route = createFileRoute("/api/public/v1/me")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request }) => {
        const raw = readBearer(request);
        if (!raw) return apiError(401, "missing_api_key", "Provide Authorization: Bearer sk_agent_...");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const identity = await authenticateAgentKey(supabaseAdmin, raw);
        if (!identity) return apiError(401, "invalid_api_key", "API key is invalid or revoked");

        const [balance, usage] = await Promise.all([
          getBalance(supabaseAdmin, identity.orgId),
          supabaseAdmin
            .from("usage_events")
            .select("id", { count: "exact", head: true })
            .eq("org_id", identity.orgId),
        ]);

        return json({
          ok: true,
          orgId: identity.orgId,
          scopes: identity.scopes,
          credits: { balance },
          usage: { totalCalls: usage.count ?? 0 },
          rateLimit: { perMinute: RATE_LIMIT_PER_MINUTE },
        });
      },
    },
  },
});

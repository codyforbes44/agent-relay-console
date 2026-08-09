import { createFileRoute } from "@tanstack/react-router";

import { catalog, catalogForOrg, json, preflight } from "@/lib/api/catalog.server";
import { authenticateAgentKey, readBearer } from "@/lib/api/keys.server";

export const Route = createFileRoute("/api/public/v1/tools")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        const raw = readBearer(request);
        if (!raw) return json(catalog(origin));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const identity = await authenticateAgentKey(supabaseAdmin, raw);
        if (!identity) return json(catalog(origin));

        return json(await catalogForOrg(supabaseAdmin, origin, identity.orgId));
      },
    },
  },
});

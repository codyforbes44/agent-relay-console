import { createFileRoute } from "@tanstack/react-router";

import { apiError, json, preflight } from "@/lib/api/catalog.server";

/** Public OAuth provider catalog: which third-party accounts a workspace can connect. */
export const Route = createFileRoute("/api/public/v1/oauth/providers")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),

      GET: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("oauth_providers")
          .select("slug, name, default_scopes, docs_url")
          .eq("enabled", true)
          .order("slug");
        if (error) {
          return apiError(500, "catalog_unavailable", "Could not load the OAuth provider catalog");
        }
        return json({
          ok: true,
          providers: ((data ?? []) as Record<string, unknown>[]).map((p) => ({
            slug: p["slug"],
            name: p["name"],
            scopes: p["default_scopes"],
            docs_url: p["docs_url"],
            authorize: {
              method: "POST",
              url: `/api/public/v1/oauth/${p["slug"]}/authorize`,
              auth: "Authorization: Bearer sk_agent_...",
            },
          })),
        });
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";

import { handleOAuthCallback } from "@/lib/api/oauth.server";

/**
 * Provider redirect target. The CSRF `state` is the only auth here: it binds
 * this callback to the workspace + key that started the dance, and it is
 * consumed atomically so an authorization code can never be replayed.
 */
export const Route = createFileRoute("/api/public/v1/oauth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = url.origin;
        const error = url.searchParams.get("error");
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");

        const redirect = (params: string) =>
          new Response(null, {
            status: 302,
            headers: { location: `${origin}/connections${params}` },
          });

        if (error) return redirect("?oauth=error&reason=provider_denied");
        if (!code || !state) return redirect("?oauth=error&reason=missing_params");

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { provider } = await handleOAuthCallback(supabaseAdmin, { code, state, origin });
          return redirect(`?connected=${encodeURIComponent(provider)}`);
        } catch {
          return redirect("?oauth=error&reason=exchange_failed");
        }
      },
    },
  },
});

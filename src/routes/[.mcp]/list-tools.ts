// route: /.mcp/list-tools
// Taken over from the auto-generated handler to apply workspace-level tool visibility.

import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";

import { createTanStackListToolsHandler } from "@lovable.dev/mcp-js/stacks/tanstack";

import mcp from "../../lib/mcp/index";
import { visibleToolsForOrg } from "@/lib/api/org-tools.server";

const baseHandler = createTanStackListToolsHandler(mcp, {
  resourcePath: "/mcp",
  metadataPath: "/.well-known/oauth-protected-resource",
  trustForwardedHost: true,
});

function readBearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return "";
}

async function resolveOrgIdFromToken(token: string): Promise<string | null> {
  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return null;
  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;

  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", data.user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return membership?.org_id ?? null;
}

export const Route = createFileRoute("/.mcp/list-tools")({
  server: {
    handlers: {
      ANY: async ({ request }) => {
        const response = await baseHandler({ request });
        if (response.status !== 200) return response;

        const token = readBearer(request);
        if (!token) return response;

        const orgId = await resolveOrgIdFromToken(token);
        if (!orgId) return response;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const visible = await visibleToolsForOrg(supabaseAdmin, orgId);
        const visibleNames = new Set(visible.map((t) => t.name));

        const body = (await response.json()) as { tools?: Array<{ name: string }> };
        const filtered = {
          ...body,
          tools: (body.tools ?? []).filter((t) => visibleNames.has(t.name)),
        };

        return Response.json(filtered, {
          status: response.status,
          headers: response.headers,
        });
      },
    },
  },
});

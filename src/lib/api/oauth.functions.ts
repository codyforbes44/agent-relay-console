import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildAuthorizeUrl, listConnections, revokeConnection } from "@/lib/api/oauth.server";
import { requireMembership } from "@/lib/api/approvals.functions";

const orgIdSchema = z.object({ orgId: z.string().uuid() });

export type OAuthProviderCard = {
  slug: string;
  name: string;
  scopes: string[];
  docsUrl: string | null;
};

/** Public catalog for the console connect cards (no secrets involved). */
export const listOAuthProviders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("oauth_providers")
      .select("slug, name, default_scopes, docs_url")
      .eq("enabled", true)
      .order("name");
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      slug: row.slug,
      name: row.name,
      scopes: row.default_scopes,
      docsUrl: row.docs_url,
    })) as OAuthProviderCard[];
  });

export const listOAuthConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string }) => orgIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireMembership(context.supabase, context.userId, data.orgId);
    return listConnections(supabaseAdmin, data.orgId);
  });

export const getOAuthAuthorizeUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; provider: string }) =>
    orgIdSchema.extend({ provider: z.string().trim().min(1).max(32) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireMembership(context.supabase, context.userId, data.orgId);
    const request = getRequest();
    const origin = request ? new URL(request.url).origin : "https://3bi.ai";
    try {
      return await buildAuthorizeUrl(supabaseAdmin, {
        provider: data.provider,
        orgId: data.orgId,
        keyId: null,
        origin,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not start the OAuth flow";
      if (message.startsWith("oauth_provider_unknown")) {
        throw new Error("Unknown OAuth provider");
      }
      throw new Error(message);
    }
  });

export const revokeOAuthConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; connectionId: string }) =>
    orgIdSchema.extend({ connectionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireMembership(context.supabase, context.userId, data.orgId);
    await revokeConnection(supabaseAdmin, data.orgId, data.connectionId);
    return { ok: true as const };
  });

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getOrgSettings, renderMcpUrl } from "@/lib/api/settings.server";

const settingsSchema = z.object({
  mcpBaseUrl: z.string().trim().url().max(200),
  mcpPathPattern: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((v) => v.startsWith("/"), "Path pattern must start with /"),
  confirmationDefault: z.enum(["side_effecting", "all", "none"]),
  jobRetentionDays: z.number().int().min(1).max(3650),
  messageRetentionDays: z.number().int().min(1).max(3650),
  defaultModel: z
    .string()
    .trim()
    .max(100)
    .refine(
      (v) =>
        v === "auto" ||
        [
          "google/gemini-3.1-flash-lite",
          "google/gemini-3.5-flash",
          "google/gemini-3.1-pro-preview",
        ].includes(v),
      "Choose a supported model or auto",
    ),
  costQualityTier: z.enum(["economy", "balanced", "quality"]),
});

export type OrgSettingsInput = z.infer<typeof settingsSchema>;

async function currentMembership(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No workspace found");
  return data as { org_id: string; role: string };
}

export const getWorkspaceSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const membership = await currentMembership(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const settings = await getOrgSettings(supabaseAdmin, membership.org_id);
    return {
      ...settings,
      role: membership.role,
      resolvedMcpUrl: renderMcpUrl(settings, membership.org_id),
    };
  });

export const updateWorkspaceSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: OrgSettingsInput) => settingsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const membership = await currentMembership(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin.from("org_settings").upsert(
      {
        org_id: membership.org_id,
        mcp_base_url: data.mcpBaseUrl.replace(/\/+$/, ""),
        mcp_path_pattern: data.mcpPathPattern,
        confirmation_default: data.confirmationDefault,
        job_retention_days: data.jobRetentionDays,
        message_retention_days: data.messageRetentionDays,
        default_model: data.defaultModel,
        cost_quality_tier: data.costQualityTier,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id" },
    );
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_logs").insert({
      org_id: membership.org_id,
      user_id: context.userId,
      action: "workspace_settings_updated",
      payload: data,
    });

    const settings = await getOrgSettings(supabaseAdmin, membership.org_id);
    return { ...settings, resolvedMcpUrl: renderMcpUrl(settings, membership.org_id) };
  });

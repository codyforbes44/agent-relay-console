import type { SupabaseClient } from "@supabase/supabase-js";

export type ConfirmationDefault = "side_effecting" | "all" | "none";

export type OrgSettings = {
  orgId: string;
  mcpBaseUrl: string;
  mcpPathPattern: string;
  confirmationDefault: ConfirmationDefault;
  jobRetentionDays: number;
  messageRetentionDays: number;
  defaultModel: string;
  costQualityTier: "economy" | "balanced" | "quality";
};

export const DEFAULT_ORG_SETTINGS: Omit<OrgSettings, "orgId"> = {
  mcpBaseUrl: "https://3bi.ai",
  mcpPathPattern: "/mcp?tenant={org_id}",
  confirmationDefault: "side_effecting",
  jobRetentionDays: 30,
  messageRetentionDays: 90,
  defaultModel: "google/gemini-3.5-flash",
  costQualityTier: "balanced",
};

/** Read a workspace's settings, falling back to defaults when no row exists yet. */
export async function getOrgSettings(admin: SupabaseClient, orgId: string): Promise<OrgSettings> {
  const { data, error } = await admin
    .from("org_settings")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  const row = data as Record<string, unknown> | null;
  if (!row) return { orgId, ...DEFAULT_ORG_SETTINGS };
  return {
    orgId,
    mcpBaseUrl: (row["mcp_base_url"] as string) ?? DEFAULT_ORG_SETTINGS.mcpBaseUrl,
    mcpPathPattern: (row["mcp_path_pattern"] as string) ?? DEFAULT_ORG_SETTINGS.mcpPathPattern,
    confirmationDefault:
      (row["confirmation_default"] as ConfirmationDefault) ??
      DEFAULT_ORG_SETTINGS.confirmationDefault,
    jobRetentionDays:
      (row["job_retention_days"] as number) ?? DEFAULT_ORG_SETTINGS.jobRetentionDays,
    messageRetentionDays:
      (row["message_retention_days"] as number) ?? DEFAULT_ORG_SETTINGS.messageRetentionDays,
    defaultModel: (row["default_model"] as string) ?? DEFAULT_ORG_SETTINGS.defaultModel,
    costQualityTier:
      (row["cost_quality_tier"] as "economy" | "balanced" | "quality") ??
      DEFAULT_ORG_SETTINGS.costQualityTier,
  };
}

/** Resolve whether a tool call needs explicit confirmation for this workspace. */
export function requiresConfirmation(mode: ConfirmationDefault, sideEffecting: boolean): boolean {
  if (mode === "all") return true;
  if (mode === "none") return false;
  return sideEffecting;
}

/** Render the workspace MCP endpoint from the configured base URL + path pattern. */
export function renderMcpUrl(
  settings: Pick<OrgSettings, "mcpBaseUrl" | "mcpPathPattern">,
  orgId: string,
) {
  const base = settings.mcpBaseUrl.replace(/\/+$/, "");
  const path = settings.mcpPathPattern.replace(/\{org_id\}/g, orgId);
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

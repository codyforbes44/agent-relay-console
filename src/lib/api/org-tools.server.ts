import type { SupabaseClient } from "@supabase/supabase-js";

import { TOOL_CONTRACTS, type ToolContract } from "@/lib/agent/contracts";

export type OrgToolRow = {
  id: string;
  org_id: string;
  tool_name: string;
  enabled: boolean;
  requires_confirmation: boolean;
  created_at: string;
  updated_at: string;
};

const DEFAULT_TOOL_NAMES = TOOL_CONTRACTS.filter((t) => t.publicApi).map((t) => t.name);

/**
 * Ensures a visibility row exists for every tool in the code registry.
 * The registry in `contracts.ts` is the single source of truth — the database
 * no longer carries a hardcoded tool list, so rows are created on demand.
 */
export async function ensureOrgToolRows(
  admin: SupabaseClient,
  orgId: string,
): Promise<void> {
  const rows = TOOL_CONTRACTS.filter((t) => t.publicApi).map((t) => ({
    org_id: orgId,
    tool_name: t.name,
    requires_confirmation: t.sideEffecting,
  }));
  const { error } = await admin
    .from("org_tools")
    .upsert(rows, { onConflict: "org_id,tool_name", ignoreDuplicates: true });
  if (error) throw error;
}

/** Returns the workspace's visibility rows for the current public tool set. */
export async function getOrgTools(
  admin: SupabaseClient,
  orgId: string,
): Promise<OrgToolRow[]> {
  const { data, error } = await admin
    .from("org_tools")
    .select("*")
    .eq("org_id", orgId)
    .in("tool_name", DEFAULT_TOOL_NAMES);
  if (error) throw error;
  return (data ?? []) as OrgToolRow[];
}

/** Build a map of tool_name -> enabled for the workspace, seeding defaults when missing. */
export async function getOrgToolEnabledMap(
  admin: SupabaseClient,
  orgId: string,
): Promise<Record<string, boolean>> {
  await ensureOrgToolRows(admin, orgId);
  const rows = await getOrgTools(admin, orgId);
  const map: Record<string, boolean> = {};
  for (const row of rows) map[row.tool_name] = row.enabled;
  for (const tool of TOOL_CONTRACTS) {
    if (!(tool.name in map)) map[tool.name] = true; // default to enabled for existing rows
  }
  return map;
}

/** True when the tool is enabled for the org (or no visibility row exists). */
export async function isToolEnabled(
  admin: SupabaseClient,
  orgId: string,
  toolName: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("org_tools")
    .select("enabled")
    .eq("org_id", orgId)
    .eq("tool_name", toolName)
    .maybeSingle();
  if (error) throw error;
  return (data as { enabled?: boolean } | null)?.enabled ?? true;
}

/** Filter the public tool contracts by org visibility. */
export async function visibleToolsForOrg(
  admin: SupabaseClient,
  orgId: string,
): Promise<ToolContract[]> {
  const map = await getOrgToolEnabledMap(admin, orgId);
  return TOOL_CONTRACTS.filter((t) => t.publicApi && map[t.name] !== false);
}

/** Toggle a tool's enabled flag for a workspace. */
export async function setToolEnabled(
  admin: SupabaseClient,
  orgId: string,
  toolName: string,
  enabled: boolean,
): Promise<void> {
  const contract = TOOL_CONTRACTS.find((t) => t.name === toolName && t.publicApi);
  if (!contract) throw new Error(`Unknown tool: ${toolName}`);

  // Upsert, not update: workspaces created before a tool existed have no row,
  // and an UPDATE against a missing row silently succeeds while changing nothing.
  const { error } = await admin.from("org_tools").upsert(
    {
      org_id: orgId,
      tool_name: toolName,
      enabled,
      requires_confirmation: contract.sideEffecting,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,tool_name" },
  );
  if (error) throw error;
}

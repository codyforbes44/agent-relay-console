import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { TOOL_CONTRACTS } from "@/lib/agent/contracts";
import { getOrgToolEnabledMap, setToolEnabled } from "@/lib/api/org-tools.server";

export const getOrgToolSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: membership, error } = await supabase
      .from("org_members")
      .select("org_id, role")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!membership) throw new Error("No workspace found");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const enabledMap = await getOrgToolEnabledMap(supabaseAdmin, membership.org_id);

    return {
      orgId: membership.org_id,
      role: membership.role,
      tools: TOOL_CONTRACTS.filter((t) => t.publicApi).map((t) => ({
        name: t.name,
        label: t.label,
        description: t.description,
        credits: t.credits,
        sideEffecting: t.sideEffecting,
        enabled: enabledMap[t.name] !== false,
      })),
    };
  });

export const updateOrgToolSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { toolName: string; enabled: boolean }) =>
    z
      .object({
        toolName: z.string().min(1),
        enabled: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: membership, error } = await supabase
      .from("org_members")
      .select("org_id, role")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!membership) throw new Error("No workspace found");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await setToolEnabled(supabaseAdmin, membership.org_id, data.toolName, data.enabled);

    await supabaseAdmin.from("audit_logs").insert({
      org_id: membership.org_id,
      user_id: userId,
      action: "tool_visibility_changed",
      tool_name: data.toolName,
      payload: { enabled: data.enabled },
    });

    return { ok: true };
  });

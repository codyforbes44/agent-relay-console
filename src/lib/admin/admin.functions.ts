import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Returns whether the signed-in user holds the platform super-admin role. */
export const getIsSuperAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("is_super_admin");
    if (error) throw new Error(error.message);
    return { isSuperAdmin: data === true };
  });

export const getAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const guard = await supabase.rpc("is_super_admin");
    if (guard.error) throw new Error(guard.error.message);
    if (guard.data !== true) throw new Error("Forbidden");

    const [orgs, profiles, keys, usage, ledger, purchases, audit] = await Promise.all([
      supabase.from("organizations").select("id, name, slug, created_at, created_by"),
      supabase.from("profiles").select("id, email, display_name, created_at"),
      supabase
        .from("agent_keys")
        .select("id, org_id, label, key_prefix, revoked_at, last_used_at, created_at"),
      supabase
        .from("usage_events")
        .select("id, org_id, tool_name, credits, status, error_code, latency_ms, created_at")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase.from("credit_ledger").select("org_id, delta"),
      supabase
        .from("credit_purchases")
        .select("id, org_id, credits, amount_cents, currency, environment, created_at")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("audit_logs")
        .select("id, org_id, action, tool_name, user_id, created_at")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    for (const r of [orgs, profiles, keys, usage, ledger, purchases, audit]) {
      if (r.error) throw new Error(r.error.message);
    }

    const balances = new Map<string, number>();
    for (const row of ledger.data ?? []) {
      balances.set(row.org_id, (balances.get(row.org_id) ?? 0) + row.delta);
    }

    const spendByOrg = new Map<string, number>();
    for (const e of usage.data ?? []) {
      spendByOrg.set(e.org_id, (spendByOrg.get(e.org_id) ?? 0) + e.credits);
    }

    const revenueCents = (purchases.data ?? []).reduce((sum, p) => sum + (p.amount_cents ?? 0), 0);

    return {
      orgs: (orgs.data ?? []).map((o) => ({
        ...o,
        balance: balances.get(o.id) ?? 0,
        recentSpend: spendByOrg.get(o.id) ?? 0,
        keyCount: (keys.data ?? []).filter((k) => k.org_id === o.id && !k.revoked_at).length,
      })),
      users: profiles.data ?? [],
      keys: keys.data ?? [],
      usage: usage.data ?? [],
      purchases: purchases.data ?? [],
      audit: audit.data ?? [],

      totals: {
        orgs: (orgs.data ?? []).length,
        users: (profiles.data ?? []).length,
        activeKeys: (keys.data ?? []).filter((k) => !k.revoked_at).length,
        creditsOutstanding: [...balances.values()].reduce((a, b) => a + b, 0),
        callsRecent: (usage.data ?? []).length,
        errorsRecent: (usage.data ?? []).filter((e) => e.status !== "success").length,
        revenueCents,
      },
    };
  });

export const adminAdjustCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; delta: number; reason: string }) =>
    z
      .object({
        orgId: z.string().uuid(),
        delta: z
          .number()
          .int()
          .refine((n) => n !== 0, "Delta must be non-zero"),
        reason: z.string().trim().min(1).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const guard = await context.supabase.rpc("is_super_admin");
    if (guard.error) throw new Error(guard.error.message);
    if (guard.data !== true) throw new Error("Forbidden");
    const { error } = await context.supabase.from("credit_ledger").insert({
      org_id: data.orgId,
      delta: data.delta,
      kind: "admin_adjustment",
      description: data.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminRevokeKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { keyId: string }) => z.object({ keyId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const guard = await context.supabase.rpc("is_super_admin");
    if (guard.error) throw new Error(guard.error.message);
    if (guard.data !== true) throw new Error("Forbidden");
    const { error } = await context.supabase
      .from("agent_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.keyId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminSetRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { userId: string; role: "super_admin" | "admin" | "member"; grant: boolean }) =>
      z
        .object({
          userId: z.string().uuid(),
          role: z.enum(["super_admin", "admin", "member"]),
          grant: z.boolean(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const guard = await context.supabase.rpc("is_super_admin");
    if (guard.error) throw new Error(guard.error.message);
    if (guard.data !== true) throw new Error("Forbidden");
    if (data.grant) {
      const { error } = await context.supabase
        .from("user_roles")
        .upsert({ user_id: data.userId, role: data.role }, { onConflict: "user_id,role" });
      if (error) throw new Error(error.message);
    } else {
      if (data.userId === context.userId && data.role === "super_admin") {
        throw new Error("You cannot remove your own super admin role");
      }
      const { error } = await context.supabase
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("role", data.role);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const getAdminRoles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const guard = await context.supabase.rpc("is_super_admin");
    if (guard.error) throw new Error(guard.error.message);
    if (guard.data !== true) throw new Error("Forbidden");
    const { data, error } = await context.supabase.from("user_roles").select("user_id, role");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

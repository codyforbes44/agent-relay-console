import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mintAgentKey } from "@/lib/api/keys.server";

export const listAgentKeys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string }) => z.object({ orgId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("agent_keys")
      .select(
        "id, label, key_prefix, scopes, revoked_at, last_used_at, created_at, max_credits_per_call, daily_credit_cap, total_credit_cap, expires_at, allowed_tools",
      )
      .eq("org_id", data.orgId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Owner-set spend guardrails. Empty/absent values clear the limit. */
export const updateKeyLimits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      keyId: string;
      maxCreditsPerCall: number | null;
      dailyCreditCap: number | null;
      totalCreditCap: number | null;
      expiresAt: string | null;
      allowedTools: string[] | null;
    }) =>
      z
        .object({
          keyId: z.string().uuid(),
          maxCreditsPerCall: z.number().int().positive().max(1_000_000).nullable(),
          dailyCreditCap: z.number().int().positive().max(10_000_000).nullable(),
          totalCreditCap: z.number().int().positive().max(100_000_000).nullable(),
          expiresAt: z.string().datetime().nullable(),
          allowedTools: z.array(z.string().min(1).max(64)).max(50).nullable(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("agent_keys")
      .update({
        max_credits_per_call: data.maxCreditsPerCall,
        daily_credit_cap: data.dailyCreditCap,
        total_credit_cap: data.totalCreditCap,
        expires_at: data.expiresAt,
        allowed_tools: data.allowedTools?.length ? data.allowedTools : null,
      })
      .eq("id", data.keyId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const createAgentKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; label: string }) =>
    z.object({ orgId: z.string().uuid(), label: z.string().trim().min(1).max(80) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const minted = await mintAgentKey();
    const { data: row, error } = await context.supabase
      .from("agent_keys")
      .insert({
        org_id: data.orgId,
        created_by: context.userId,
        label: data.label,
        key_prefix: minted.prefix,
        key_hash: minted.hash,
      })
      .select("id, label, key_prefix, created_at")
      .single();
    if (error) throw new Error(error.message);
    // The plaintext key is returned exactly once and never stored.
    return { ...row, key: minted.key };
  });

export const revokeAgentKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { keyId: string }) => z.object({ keyId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("agent_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.keyId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getAccountSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string }) => z.object({ orgId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: allowed, error: accessError } = await context.supabase.rpc("has_org_access", {
      _org_id: data.orgId,
    });
    if (accessError) throw new Error(accessError.message);
    if (!allowed) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: balance }, { data: events }] = await Promise.all([
      supabaseAdmin.rpc("org_credit_balance", { _org_id: data.orgId }),
      supabaseAdmin
        .from("usage_events")
        .select("id, tool_name, credits, status, error_code, latency_ms, created_at")
        .eq("org_id", data.orgId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    const rows = events ?? [];
    return {
      balance: Number(balance ?? 0),
      totalCalls: rows.length,
      spentLast50: rows.reduce((sum, r) => sum + (r.credits ?? 0), 0),
      events: rows,
    };
  });

/**
 * Credit metering + per-key rate limiting for the public machine API.
 * All writes go through the service-role client (no end-user session exists
 * on machine calls), scoped explicitly to the key's org.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { KeyIdentity } from "@/lib/api/keys.server";

export const RATE_LIMIT_PER_MINUTE = 60;

export async function getBalance(admin: SupabaseClient, orgId: string): Promise<number> {
  const { data, error } = await admin.rpc("org_credit_balance", { _org_id: orgId });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export async function checkRateLimit(admin: SupabaseClient, keyId: string): Promise<boolean> {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count, error } = await admin
    .from("usage_events")
    .select("id", { count: "exact", head: true })
    .eq("key_id", keyId)
    .gte("created_at", since);
  if (error) return true;
  return (count ?? 0) < RATE_LIMIT_PER_MINUTE;
}

export type MeterInput = {
  orgId: string;
  keyId: string;
  toolName: string;
  credits: number;
  status: "success" | "error" | "rejected";
  errorCode?: string | null;
  latencyMs: number;
  requestId: string;
};

/** Records a usage event and (for billable calls) the matching ledger debit. */
export async function recordUsage(admin: SupabaseClient, input: MeterInput) {
  const { data, error } = await admin
    .from("usage_events")
    .insert({
      org_id: input.orgId,
      key_id: input.keyId,
      tool_name: input.toolName,
      credits: input.credits,
      status: input.status,
      error_code: input.errorCode ?? null,
      latency_ms: input.latencyMs,
      request_id: input.requestId,
    })
    .select("id")
    .single();
  if (error) return;

  if (input.credits > 0) {
    await admin.from("credit_ledger").insert({
      org_id: input.orgId,
      delta: -input.credits,
      kind: "usage",
      description: `Tool call: ${input.toolName}`,
      usage_event_id: data.id,
    });
  }
}

export async function touchKey(admin: SupabaseClient, keyId: string) {
  await admin.from("agent_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyId);
}

export type GuardrailViolation = { status: number; code: string; message: string; extra?: Record<string, unknown> };

/**
 * Owner-set spend guardrails, enforced before a tool runs. Keys with no
 * limits configured pass straight through.
 */
export async function checkKeyGuardrails(
  admin: SupabaseClient,
  identity: KeyIdentity,
  toolName: string,
  credits: number,
): Promise<GuardrailViolation | null> {
  const { limits } = identity;

  if (limits.expiresAt && new Date(limits.expiresAt).getTime() <= Date.now()) {
    return { status: 401, code: "key_expired", message: "This API key has passed its expiry date", extra: { expiredAt: limits.expiresAt } };
  }

  if (limits.allowedTools && limits.allowedTools.length > 0 && !limits.allowedTools.includes(toolName)) {
    return {
      status: 403,
      code: "tool_not_allowed",
      message: `This key may only call: ${limits.allowedTools.join(", ")}`,
      extra: { allowedTools: limits.allowedTools },
    };
  }

  if (limits.maxCreditsPerCall !== null && credits > limits.maxCreditsPerCall) {
    return {
      status: 403,
      code: "budget_exceeded",
      message: "This call costs more than the key's per-call credit limit",
      extra: { required: credits, limit: limits.maxCreditsPerCall, window: "call" },
    };
  }

  if (limits.dailyCreditCap !== null) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const spent = await keyCreditsSpent(admin, identity.keyId, since);
    if (spent + credits > limits.dailyCreditCap) {
      return {
        status: 403,
        code: "budget_exceeded",
        message: "This call would exceed the key's 24-hour credit cap",
        extra: { spent, required: credits, limit: limits.dailyCreditCap, window: "24h" },
      };
    }
  }

  if (limits.totalCreditCap !== null) {
    const spent = await keyCreditsSpent(admin, identity.keyId, new Date(0).toISOString());
    if (spent + credits > limits.totalCreditCap) {
      return {
        status: 403,
        code: "budget_exceeded",
        message: "This call would exceed the key's lifetime credit cap",
        extra: { spent, required: credits, limit: limits.totalCreditCap, window: "lifetime" },
      };
    }
  }

  return null;
}

export async function keyCreditsSpent(admin: SupabaseClient, keyId: string, since: string): Promise<number> {
  const { data, error } = await admin.rpc("key_credits_spent", { _key_id: keyId, _since: since });
  if (error) return 0;
  return Number(data ?? 0);
}

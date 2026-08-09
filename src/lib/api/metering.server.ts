/**
 * Credit metering + per-key rate limiting for the public machine API.
 * All writes go through the service-role client (no end-user session exists
 * on machine calls), scoped explicitly to the key's org.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { KeyIdentity } from "@/lib/api/keys.server";

export const RATE_LIMIT_PER_MINUTE = 60;

/** Workspaces flagged unlimited (internal/admin) never run out of credits. */
export const UNLIMITED_BALANCE = Number.MAX_SAFE_INTEGER;

export async function hasUnlimitedCredits(admin: SupabaseClient, orgId: string): Promise<boolean> {
  const { data, error } = await admin.rpc("org_unlimited_credits", { _org_id: orgId });
  if (error) return false;
  return data === true;
}

export async function getBalance(admin: SupabaseClient, orgId: string): Promise<number> {
  if (await hasUnlimitedCredits(admin, orgId)) return UNLIMITED_BALANCE;
  const { data, error } = await admin.rpc("org_credit_balance", { _org_id: orgId });
  if (error) {
    console.error(JSON.stringify({ event: "balance_read_failed", orgId, message: error.message }));
    throw new BalanceUnavailableError(error.message);
  }
  return Number(data ?? 0);
}

/** Thrown when the ledger cannot be read; callers map this to a 503. */
export class BalanceUnavailableError extends Error {
  readonly code = "balance_unavailable";
  constructor(message: string) {
    super(message);
    this.name = "BalanceUnavailableError";
  }
}

export type ReserveInput = {
  orgId: string;
  keyId: string | null;
  toolName: string;
  credits: number;
  requestId: string;
  maxPerCall?: number | null;
  dailyCap?: number | null;
  totalCap?: number | null;
};

export type ReserveResult =
  | { status: "ok"; usageEventId: string; balance: number; unlimited: boolean }
  | { status: "insufficient"; balance: number; required: number }
  | { status: "budget_exceeded"; window: string; spent: number; required: number; limit: number }
  | { status: "error"; message: string };

/**
 * Atomically authorizes and charges a call *before* the tool runs.
 * Balance and owner-set spend caps are evaluated inside one transaction under
 * a per-org lock, so concurrent calls cannot double-spend.
 */
export async function reserveCredits(admin: SupabaseClient, input: ReserveInput): Promise<ReserveResult> {
  const { data, error } = await admin.rpc("reserve_credits", {
    _org_id: input.orgId,
    _key_id: input.keyId,
    _tool_name: input.toolName,
    _credits: input.credits,
    _request_id: input.requestId,
    _latency_ms: 0,
    _max_per_call: input.maxPerCall ?? null,
    _daily_cap: input.dailyCap ?? null,
    _total_cap: input.totalCap ?? null,
  });
  if (error) {
    console.error(JSON.stringify({ event: "reserve_credits_failed", orgId: input.orgId, message: error.message }));
    return { status: "error", message: error.message };
  }
  const row = (data ?? {}) as Record<string, unknown>;
  const status = String(row["status"] ?? "error");
  if (status === "ok") {
    const unlimited = row["unlimited"] === true;
    return {
      status: "ok",
      usageEventId: String(row["usageEventId"]),
      unlimited,
      balance: unlimited ? UNLIMITED_BALANCE : Number(row["balance"] ?? 0),
    };
  }
  if (status === "insufficient") {
    return {
      status: "insufficient",
      balance: Number(row["balance"] ?? 0),
      required: Number(row["required"] ?? input.credits),
    };
  }
  if (status === "budget_exceeded") {
    return {
      status: "budget_exceeded",
      window: String(row["window"] ?? "call"),
      spent: Number(row["spent"] ?? 0),
      required: Number(row["required"] ?? input.credits),
      limit: Number(row["limit"] ?? 0),
    };
  }
  return { status: "error", message: "Unexpected reservation result" };
}

/** Compensating entry when a tool throws after its credits were reserved. */
export async function refundReservedCredits(admin: SupabaseClient, usageEventId: string, reason: string) {
  const { error } = await admin.rpc("refund_reserved_credits", {
    _usage_event_id: usageEventId,
    _reason: reason,
  });
  if (error) {
    console.error(JSON.stringify({ event: "refund_failed", usageEventId, message: error.message }));
  }
}

/** Post-execution patch of the reserved usage row (latency only). */
export async function finalizeUsage(admin: SupabaseClient, usageEventId: string, latencyMs: number) {
  const { error } = await admin.from("usage_events").update({ latency_ms: latencyMs }).eq("id", usageEventId);
  if (error) {
    console.error(JSON.stringify({ event: "metering_write_failed", usageEventId, message: error.message }));
  }
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

  if (input.credits > 0 && !(await hasUnlimitedCredits(admin, input.orgId))) {
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
 * Non-monetary key checks (expiry, allowed tools). These are not racy.
 * Spend caps are enforced atomically inside `reserve_credits`.
 */
export async function checkKeyGuardrails(
  _admin: SupabaseClient,
  identity: KeyIdentity,
  toolName: string,
  _credits: number,
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

  return null;
}

const BUDGET_MESSAGE: Record<string, string> = {
  call: "This call costs more than the key's per-call credit limit",
  "24h": "This call would exceed the key's 24-hour credit cap",
  lifetime: "This call would exceed the key's lifetime credit cap",
};

/** Maps a `budget_exceeded` reservation result to the API error shape. */
export function budgetViolation(result: {
  window: string;
  spent: number;
  required: number;
  limit: number;
}): GuardrailViolation {
  return {
    status: 403,
    code: "budget_exceeded",
    message: BUDGET_MESSAGE[result.window] ?? "This call would exceed the key's credit cap",
    extra: { spent: result.spent, required: result.required, limit: result.limit, window: result.window },
  };
}

export async function keyCreditsSpent(admin: SupabaseClient, keyId: string, since: string): Promise<number> {
  const { data, error } = await admin.rpc("key_credits_spent", { _key_id: keyId, _since: since });
  if (error) return 0;
  return Number(data ?? 0);
}

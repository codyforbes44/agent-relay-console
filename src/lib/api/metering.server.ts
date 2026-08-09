/**
 * Credit metering + per-key rate limiting for the public machine API.
 * All writes go through the service-role client (no end-user session exists
 * on machine calls), scoped explicitly to the key's org.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

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

/**
 * Agent self-serve onboarding: anonymous workspace creation, per-IP quota,
 * claim-link minting and key rotation. Service-role only; never imported
 * from browser code.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { mintAgentKey, sha256Hex } from "./keys.server";
import {
  CLAIM_TOKEN_TTL_MINUTES,
  KEY_ROTATION_OVERLAP_MINUTES,
  SIGNUP_MAX_PER_IP,
  SIGNUP_WINDOW_HOURS,
} from "./onboarding";

export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function randomToken(len = 48) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/**
 * Counts (and records) a signup attempt for this IP.
 * Returns false when the caller has exceeded the rolling window quota.
 */
export async function consumeSignupQuota(admin: SupabaseClient, ip: string): Promise<boolean> {
  const ipHash = await sha256Hex(ip);
  const windowStart = new Date();
  windowStart.setUTCMinutes(0, 0, 0);

  const since = new Date(Date.now() - SIGNUP_WINDOW_HOURS * 3600_000).toISOString();
  const { data: rows } = await admin
    .from("signup_attempts")
    .select("count")
    .eq("ip_hash", ipHash)
    .gte("window_start", since);

  const used = (rows ?? []).reduce((sum, r) => sum + Number(r.count ?? 0), 0);

  const { data: current } = await admin
    .from("signup_attempts")
    .select("count")
    .eq("ip_hash", ipHash)
    .eq("window_start", windowStart.toISOString())
    .maybeSingle();

  await admin.from("signup_attempts").upsert(
    {
      ip_hash: ipHash,
      window_start: windowStart.toISOString(),
      count: Number(current?.count ?? 0) + 1,
    },
    { onConflict: "ip_hash,window_start" },
  );

  return used < SIGNUP_MAX_PER_IP;
}

export type AgentWorkspace = {
  orgId: string;
  keyId: string;
  apiKey: string;
  keyPrefix: string;
};

/** Creates an unowned workspace plus its first API key. */
export async function createAgentWorkspace(
  admin: SupabaseClient,
  input: { label?: string | undefined; email?: string | undefined },
): Promise<AgentWorkspace> {
  const label = (input.label ?? "Agent workspace").slice(0, 80);
  const slug = `agent-${randomToken(16).toLowerCase()}`;

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: label, slug, created_by: null, origin: "agent" })
    .select("id")
    .single();
  if (orgError || !org) throw new Error(orgError?.message ?? "workspace_create_failed");

  const minted = await mintAgentKey();
  const { data: key, error: keyError } = await admin
    .from("agent_keys")
    .insert({
      org_id: org.id,
      label: `${label} key`,
      key_prefix: minted.prefix,
      key_hash: minted.hash,
      scopes: ["tools:invoke"],
    })
    .select("id")
    .single();
  if (keyError || !key) throw new Error(keyError?.message ?? "key_create_failed");

  await admin.from("audit_logs").insert({
    org_id: org.id,
    action: "agent.signup",
    payload: { contact_email: input.email ?? null, label },
  });

  return { orgId: org.id, keyId: key.id, apiKey: minted.key, keyPrefix: minted.prefix };
}

export type ClaimLink = { token: string; url: string; expiresAt: string };

/** Mints a single-use, short-lived claim token for a workspace. */
export async function createClaimToken(
  admin: SupabaseClient,
  orgId: string,
  origin: string,
): Promise<ClaimLink> {
  const token = randomToken(48);
  const expiresAt = new Date(Date.now() + CLAIM_TOKEN_TTL_MINUTES * 60_000).toISOString();

  const { error } = await admin.from("claim_tokens").insert({
    org_id: orgId,
    token_hash: await sha256Hex(token),
    expires_at: expiresAt,
  });
  if (error) throw new Error(error.message);

  return { token, url: `${origin}/claim?token=${token}`, expiresAt };
}

/** Issues a replacement key and schedules revocation of the current one. */
export async function rotateAgentKey(admin: SupabaseClient, orgId: string, keyId: string) {
  const minted = await mintAgentKey();
  const { data: created, error } = await admin
    .from("agent_keys")
    .insert({
      org_id: orgId,
      label: "Rotated key",
      key_prefix: minted.prefix,
      key_hash: minted.hash,
      scopes: ["tools:invoke"],
    })
    .select("id")
    .single();
  if (error || !created) throw new Error(error?.message ?? "key_rotate_failed");

  const revokeAt = new Date(Date.now() + KEY_ROTATION_OVERLAP_MINUTES * 60_000).toISOString();
  await admin.from("agent_keys").update({ revoked_at: revokeAt }).eq("id", keyId);

  await admin.from("audit_logs").insert({
    org_id: orgId,
    action: "agent.key.rotate",
    payload: { previous_key_id: keyId, new_key_id: created.id },
  });

  return { apiKey: minted.key, keyId: created.id, previousKeyRevokedAt: revokeAt };
}

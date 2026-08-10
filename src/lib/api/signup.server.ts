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

/**
 * Client IP. The app sits behind Cloudflare, so `cf-connecting-ip` is
 * authoritative. The spoofable forwarded headers are only consulted when
 * TRUST_FORWARDED_IP is set, so an unfronted deploy fails closed to a single
 * shared bucket instead of letting a caller mint a fresh identity per request.
 */
export function clientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  if (process.env["TRUST_FORWARDED_IP"] === "true") {
    return (
      request.headers.get("x-real-ip")?.trim() ??
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown"
    );
  }
  return "unknown";
}

/** Uniform random token — rejection sampling avoids modulo bias. */
function randomToken(len = 48) {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const max = Math.floor(256 / alphabet.length) * alphabet.length;
  let out = "";
  while (out.length < len) {
    const bytes = crypto.getRandomValues(new Uint8Array(len));
    for (const b of bytes) {
      if (b >= max) continue;
      out += alphabet[b % alphabet.length];
      if (out.length === len) break;
    }
  }
  return out;
}

/**
 * Counts (and records) a signup attempt for this IP in one atomic statement.
 * Returns false when the caller has exceeded the rolling window quota.
 */
export async function consumeSignupQuota(admin: SupabaseClient, ip: string): Promise<boolean> {
  const ipHash = await sha256Hex(ip);
  const { data, error } = await admin.rpc("consume_signup_quota", {
    _ip_hash: ipHash,
    _max: SIGNUP_MAX_PER_IP,
    _window_hours: SIGNUP_WINDOW_HOURS,
  });
  if (error) {
    console.error(JSON.stringify({ event: "signup_quota_failed", message: error.message }));
    return false;
  }
  return data === true;
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

/**
 * API key minting + verification for the machine-facing API.
 * Only the SHA-256 hash of the secret is stored; the plaintext key is
 * returned exactly once at creation time.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomString(len: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export async function sha256Hex(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type MintedKey = { key: string; prefix: string; hash: string };

export async function mintAgentKey(): Promise<MintedKey> {
  const prefix = randomString(8);
  const secret = randomString(40);
  const key = `sk_agent_${prefix}_${secret}`;
  return { key, prefix, hash: await sha256Hex(secret) };
}

export function parseAgentKey(raw: string): { prefix: string; secret: string } | null {
  const parts = raw.trim().split("_");
  if (parts.length !== 4 || parts[0] !== "sk" || parts[1] !== "agent") return null;
  const [, , prefix, secret] = parts;
  if (!prefix || !secret) return null;
  return { prefix, secret };
}

export function readBearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return request.headers.get("x-api-key")?.trim() ?? "";
}

export type KeyIdentity = { keyId: string; orgId: string; scopes: string[] };

export async function authenticateAgentKey(
  admin: SupabaseClient,
  raw: string,
): Promise<KeyIdentity | null> {
  const parsed = parseAgentKey(raw);
  if (!parsed) return null;

  const { data, error } = await admin
    .from("agent_keys")
    .select("id, org_id, key_hash, scopes, revoked_at")
    .eq("key_prefix", parsed.prefix)
    .maybeSingle();
  if (error || !data) return null;
  // revoked_at may be set in the future (rotation grace period).
  if (data.revoked_at && new Date(data.revoked_at).getTime() <= Date.now()) return null;

  const hash = await sha256Hex(parsed.secret);
  // Constant-time-ish compare on equal-length hex digests.
  if (hash.length !== data.key_hash.length) return null;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ data.key_hash.charCodeAt(i);
  if (diff !== 0) return null;

  return { keyId: data.id, orgId: data.org_id, scopes: data.scopes ?? [] };
}

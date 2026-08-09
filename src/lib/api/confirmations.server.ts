import type { SupabaseClient } from "@supabase/supabase-js";

import type { ToolContract } from "@/lib/agent/contracts";

/**
 * Bound confirmation tokens.
 *
 * A side-effecting call arrives unauthorized -> we return 428 with a preview
 * and a one-shot token bound to (workspace, key, tool, exact arguments).
 * The follow-up call must present that token, so an agent can never
 * "pre-confirm" arguments a human never saw.
 */

export const CONFIRMATION_TTL_MINUTES = 10;
export const CONFIRMATION_HEADER = "x-confirmation-token";

/** Stable JSON: object keys sorted recursively so hashing is order-independent. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonicalize(v)]),
    );
  }
  return value;
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function argsHashInput(toolName: string, args: unknown): string {
  return `${toolName}:${JSON.stringify(canonicalize(args))}`;
}

export async function hashArgs(toolName: string, args: unknown): Promise<string> {
  return sha256(argsHashInput(toolName, args));
}

export type IssuedConfirmation = {
  token: string;
  expiresAt: string;
  preview: { summary: string; args: Record<string, unknown> };
};

/** Creates a pending confirmation and returns the raw token (stored hashed). */
export async function issueConfirmation(
  admin: SupabaseClient,
  input: {
    orgId: string;
    keyId: string | null;
    tool: ToolContract;
    args: Record<string, unknown>;
  },
): Promise<IssuedConfirmation> {
  const token = `cnf_${crypto.randomUUID().replace(/-/g, "")}`;
  const tokenHash = await sha256(token);
  const argsHash = await hashArgs(input.tool.name, input.args);
  const expiresAt = new Date(Date.now() + CONFIRMATION_TTL_MINUTES * 60_000).toISOString();
  const preview = { summary: input.tool.summarize(input.args), args: input.args };

  await admin.from("tool_confirmations").insert({
    token_hash: tokenHash,
    org_id: input.orgId,
    key_id: input.keyId,
    tool_name: input.tool.name,
    args_hash: argsHash,
    preview,
    credits: input.tool.credits,
    expires_at: expiresAt,
  });

  return { token, expiresAt, preview };
}

export type RedeemFailure = {
  status: number;
  code: "confirmation_invalid" | "confirmation_mismatch" | "confirmation_expired" | "confirmation_used";
  message: string;
  extra?: Record<string, unknown>;
};

export type RedeemResult =
  | { ok: true; id: string; replay: Record<string, unknown> | null }
  | { ok: false; failure: RedeemFailure };

/**
 * Validates a token against the exact call being made and marks it redeemed.
 * A token already redeemed replays its stored response instead of executing.
 */
export async function redeemConfirmation(
  admin: SupabaseClient,
  input: {
    token: string;
    orgId: string;
    toolName: string;
    args: Record<string, unknown>;
  },
): Promise<RedeemResult> {
  const tokenHash = await sha256(input.token);
  const { data: row } = await admin
    .from("tool_confirmations")
    .select("id, org_id, tool_name, args_hash, status, expires_at, response")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!row || row.org_id !== input.orgId) {
    return {
      ok: false,
      failure: {
        status: 403,
        code: "confirmation_invalid",
        message:
          "Unknown confirmation token. Call the tool without a token first to receive a preview and a fresh token.",
      },
    };
  }

  if (row.tool_name !== input.toolName) {
    return {
      ok: false,
      failure: {
        status: 409,
        code: "confirmation_mismatch",
        message: `This token was issued for ${row.tool_name}, not ${input.toolName}.`,
      },
    };
  }

  const expected = await hashArgs(input.toolName, input.args);
  if (expected !== row.args_hash) {
    return {
      ok: false,
      failure: {
        status: 409,
        code: "confirmation_mismatch",
        message:
          "The arguments differ from the ones that were previewed and approved. Request a new confirmation for the exact body you intend to send.",
      },
    };
  }

  if (row.status === "redeemed") {
    return { ok: true, id: row.id, replay: (row.response as Record<string, unknown> | null) ?? null };
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    return {
      ok: false,
      failure: {
        status: 410,
        code: "confirmation_expired",
        message: `Confirmation tokens are valid for ${CONFIRMATION_TTL_MINUTES} minutes. Call again without a token to get a new preview.`,
      },
    };
  }

  const { data: claimed } = await admin
    .from("tool_confirmations")
    .update({ status: "redeemed", redeemed_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (!claimed) {
    return {
      ok: false,
      failure: {
        status: 409,
        code: "confirmation_used",
        message: "This confirmation token was already redeemed. Request a new one for the next call.",
      },
    };
  }

  return { ok: true, id: row.id, replay: null };
}

/** Stores the successful response so a token replay is idempotent. */
export async function storeConfirmationResponse(
  admin: SupabaseClient,
  id: string,
  response: Record<string, unknown>,
): Promise<void> {
  await admin.from("tool_confirmations").update({ response }).eq("id", id);
}

/** Releases a redeemed token when the call did not complete. */
export async function releaseConfirmation(admin: SupabaseClient, id: string): Promise<void> {
  await admin
    .from("tool_confirmations")
    .update({ status: "pending", redeemed_at: null })
    .eq("id", id)
    .is("response", null);
}

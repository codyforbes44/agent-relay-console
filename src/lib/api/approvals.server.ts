import type { SupabaseClient } from "@supabase/supabase-js";

import { TOOLS_BY_NAME, type ToolContract } from "@/lib/agent/contracts";
import { hashArgs, issueConfirmation, revokeConfirmationsForIntent } from "./confirmations.server";

/**
 * Async approval flow.
 *
 * The classic 428 flow is synchronous: the agent calls, gets a preview +
 * token, and must immediately bring a human to approve. This module adds the
 * asynchronous twin: every side-effecting call also mints an approval intent
 * that a human can decide later from the console inbox, while the agent polls
 * or waits for a signed webhook. On approval the server issues the same
 * single-use, args-bound confirmation token the sync flow uses — one hardened
 * path, two tempos.
 */

export const APPROVAL_TTL_HOURS = 24;
export const APPROVAL_POLL_ROUTE = "/api/public/v1/approvals";

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired" | "cancelled";
export type PolicyDecision = "auto" | "human";

export type ApprovalPolicy = {
  orgId: string;
  autoApproveMaxCredits: number;
  autoApproveTools: string[];
  requireHumanTools: string[];
  defaultAction: "human" | "auto";
  webhookSecret: string;
  notifyEmail: string | null;
};

export type ApprovalIntent = {
  id: string;
  orgId: string;
  keyId: string | null;
  toolName: string;
  toolLabel: string;
  args: Record<string, unknown>;
  argsHash: string;
  preview: { summary: string; args: Record<string, unknown> };
  credits: number;
  idempotencyKey: string | null;
  callbackUrl: string | null;
  status: ApprovalStatus;
  policyDecision: PolicyDecision;
  confirmationToken: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
  expiresAt: string;
  createdAt: string;
};

/** JSON-compatible value: what actually survives the server-function boundary. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * ApprovalIntent with JSON-safe args/preview for server-function returns.
 * TanStack Start validates that server-function results are serializable, and
 * `Record<string, unknown>` does not satisfy that check at the type level.
 */
export type ApprovalIntentView = Omit<ApprovalIntent, "args" | "preview"> & {
  args: Record<string, JsonValue>;
  preview: { summary: string; args: Record<string, JsonValue> };
};

/** Normalizes an intent for the client: the JSON round-trip strips non-JSON values. */
export function toApprovalIntentView(intent: ApprovalIntent): ApprovalIntentView {
  return JSON.parse(JSON.stringify(intent)) as ApprovalIntentView;
}

const DEFAULT_POLICY: Omit<ApprovalPolicy, "orgId"> = {
  autoApproveMaxCredits: 0,
  autoApproveTools: [],
  requireHumanTools: [],
  defaultAction: "human",
  webhookSecret: "",
  notifyEmail: null,
};

function rowToPolicy(orgId: string, row: Record<string, unknown> | null): ApprovalPolicy {
  if (!row) return { orgId, ...DEFAULT_POLICY };
  return {
    orgId,
    autoApproveMaxCredits: Number(row["auto_approve_max_credits"] ?? 0),
    autoApproveTools: (row["auto_approve_tools"] as string[]) ?? [],
    requireHumanTools: (row["require_human_tools"] as string[]) ?? [],
    defaultAction: (row["default_action"] as "human" | "auto") ?? "human",
    webhookSecret: String(row["webhook_secret"] ?? ""),
    notifyEmail: (row["notify_email"] as string | null) ?? null,
  };
}

function rowToIntent(row: Record<string, unknown>): ApprovalIntent {
  return {
    id: String(row["id"]),
    orgId: String(row["org_id"]),
    keyId: (row["key_id"] as string | null) ?? null,
    toolName: String(row["tool_name"]),
    toolLabel: String(row["tool_label"]),
    args: (row["args"] as Record<string, unknown>) ?? {},
    argsHash: String(row["args_hash"] ?? ""),
    preview: (row["preview"] as ApprovalIntent["preview"]) ?? { summary: "", args: {} },
    credits: Number(row["credits"] ?? 0),
    idempotencyKey: (row["idempotency_key"] as string | null) ?? null,
    callbackUrl: (row["callback_url"] as string | null) ?? null,
    status: row["status"] as ApprovalStatus,
    policyDecision: row["policy_decision"] as PolicyDecision,
    confirmationToken: (row["confirmation_token"] as string | null) ?? null,
    decidedBy: (row["decided_by"] as string | null) ?? null,
    decidedAt: (row["decided_at"] as string | null) ?? null,
    reason: (row["reason"] as string | null) ?? null,
    expiresAt: String(row["expires_at"]),
    createdAt: String(row["created_at"]),
  };
}

/** Reads the workspace policy, falling back to human-everything defaults. */
export async function getApprovalPolicy(
  admin: SupabaseClient,
  orgId: string,
): Promise<ApprovalPolicy> {
  const { data, error } = await admin
    .from("approval_policies")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return rowToPolicy(orgId, data as Record<string, unknown> | null);
}

/** Creates or replaces the workspace policy. */
export async function upsertApprovalPolicy(
  admin: SupabaseClient,
  orgId: string,
  patch: Partial<Omit<ApprovalPolicy, "orgId" | "webhookSecret">>,
): Promise<ApprovalPolicy> {
  const row: Record<string, unknown> = { org_id: orgId, updated_at: new Date().toISOString() };
  if (patch.autoApproveMaxCredits !== undefined)
    row["auto_approve_max_credits"] = Math.max(0, Math.floor(patch.autoApproveMaxCredits));
  if (patch.autoApproveTools !== undefined)
    row["auto_approve_tools"] = patch.autoApproveTools.slice(0, 100);
  if (patch.requireHumanTools !== undefined)
    row["require_human_tools"] = patch.requireHumanTools.slice(0, 100);
  if (patch.defaultAction !== undefined) row["default_action"] = patch.defaultAction;
  if (patch.notifyEmail !== undefined) row["notify_email"] = patch.notifyEmail || null;
  const { data, error } = await admin
    .from("approval_policies")
    .upsert(row, { onConflict: "org_id" })
    .select("*")
    .single();
  if (error) throw error;
  return rowToPolicy(orgId, data as Record<string, unknown>);
}

/**
 * Evaluates the policy for a call. Explicit human-required tools always win,
 * then the auto-approve allowlist, then the credit ceiling under an "auto"
 * default. Everything else goes to a human.
 */
export function evaluatePolicy(
  policy: ApprovalPolicy,
  toolName: string,
  credits: number,
): PolicyDecision {
  if (policy.requireHumanTools.includes(toolName)) return "human";
  if (policy.autoApproveTools.includes(toolName)) return "auto";
  if (policy.defaultAction === "auto" && credits <= policy.autoApproveMaxCredits) return "auto";
  return "human";
}

/** Callback URLs must be https (http only for loopback), so tokens never leak over cleartext. */
export function sanitizeCallbackUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol === "https:") return url.toString();
  if (url.protocol === "http:" && loopback) return url.toString();
  return null;
}

/**
 * Mints an approval intent for a side-effecting call. When the policy
 * auto-approves, the single-use confirmation token is issued immediately and
 * the intent is born approved; otherwise it waits for a human decision.
 */
export async function createApprovalIntent(
  admin: SupabaseClient,
  input: {
    orgId: string;
    keyId: string | null;
    tool: ToolContract;
    args: Record<string, unknown>;
    callbackUrl?: string | null;
    idempotencyKey?: string | null;
  },
): Promise<{ intent: ApprovalIntent; autoApproved: boolean }> {
  const policy = await getApprovalPolicy(admin, input.orgId);
  const decision = evaluatePolicy(policy, input.tool.name, input.tool.credits);
  const argsHash = await hashArgs(input.tool.name, input.args);
  const preview = { summary: input.tool.summarize(input.args), args: input.args };
  const expiresAt = new Date(Date.now() + APPROVAL_TTL_HOURS * 3_600_000).toISOString();

  const { data, error } = await admin
    .from("approval_intents")
    .insert({
      org_id: input.orgId,
      key_id: input.keyId,
      tool_name: input.tool.name,
      tool_label: input.tool.label,
      args: input.args,
      args_hash: argsHash,
      preview,
      credits: input.tool.credits,
      idempotency_key: input.idempotencyKey ?? null,
      callback_url: sanitizeCallbackUrl(input.callbackUrl),
      status: "pending",
      policy_decision: decision,
      expires_at: expiresAt,
    })
    .select("*")
    .single();
  if (error) throw error;
  const intent = rowToIntent(data as Record<string, unknown>);

  if (decision === "auto") {
    const issued = await issueConfirmation(admin, {
      orgId: input.orgId,
      keyId: input.keyId,
      tool: input.tool,
      args: input.args,
      intentId: intent.id,
    });
    const { data: decided, error: decideError } = await admin
      .from("approval_intents")
      .update({
        status: "approved",
        confirmation_token: issued.token,
        decided_by: "policy:auto-approve",
        decided_at: new Date().toISOString(),
      })
      .eq("id", intent.id)
      .eq("status", "pending")
      .select("*")
      .single();
    if (decideError) throw decideError;
    const approved = rowToIntent(decided as Record<string, unknown>);
    void deliverDecisionWebhook(admin, approved);
    return { intent: approved, autoApproved: true };
  }

  return { intent, autoApproved: false };
}

/** Agent poll: fetch one intent scoped to its workspace. Never reveals other orgs' rows. */
export async function getApprovalIntentForOrg(
  admin: SupabaseClient,
  orgId: string,
  intentId: string,
): Promise<ApprovalIntent | null> {
  await expireStaleIntents(admin, orgId);
  const { data, error } = await admin
    .from("approval_intents")
    .select("*")
    .eq("id", intentId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToIntent(data as Record<string, unknown>) : null;
}

/** Console inbox: list intents for a workspace, newest first, optional status filter. */
export async function listApprovalIntentsForOrg(
  admin: SupabaseClient,
  orgId: string,
  status?: ApprovalStatus | "all",
): Promise<ApprovalIntent[]> {
  await expireStaleIntents(admin, orgId);
  let query = admin
    .from("approval_intents")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (status && status !== "all") query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(rowToIntent);
}

/** Marks pending intents past their TTL as expired. Best-effort, idempotent. */
export async function expireStaleIntents(admin: SupabaseClient, orgId: string): Promise<void> {
  const { data } = await admin
    .from("approval_intents")
    .update({ status: "expired" })
    .eq("org_id", orgId)
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString())
    .select("id");
  for (const row of (data ?? []) as Array<{ id: string }>) {
    await revokeConfirmationsForIntent(admin, row.id);
  }
}

export type DecideResult =
  | { ok: true; intent: ApprovalIntent }
  | {
      ok: false;
      code: "approval_not_found" | "approval_not_pending" | "approval_expired" | "unknown_tool";
    };

/**
 * Human decision from the console inbox. Approve issues the single-use,
 * args-bound confirmation token (same machinery as the sync 428 flow) and
 * stores it on the intent for the polling agent; deny just records the reason.
 * Either way a signed webhook fires when the agent registered a callback URL.
 */
export async function decideApprovalIntent(
  admin: SupabaseClient,
  input: {
    intentId: string;
    orgId: string;
    decision: "approved" | "denied";
    decidedBy: string;
    reason?: string | null;
  },
): Promise<DecideResult> {
  const { data: row, error } = await admin
    .from("approval_intents")
    .select("*")
    .eq("id", input.intentId)
    .eq("org_id", input.orgId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return { ok: false, code: "approval_not_found" };
  const intent = rowToIntent(row as Record<string, unknown>);
  if (intent.status !== "pending") return { ok: false, code: "approval_not_pending" };
  if (new Date(intent.expiresAt).getTime() < Date.now()) {
    await admin.from("approval_intents").update({ status: "expired" }).eq("id", intent.id);
    await revokeConfirmationsForIntent(admin, intent.id);
    return { ok: false, code: "approval_expired" };
  }

  let confirmationToken: string | null = null;
  if (input.decision === "approved") {
    const tool = TOOLS_BY_NAME[intent.toolName];
    if (!tool) return { ok: false, code: "unknown_tool" };
    const issued = await issueConfirmation(admin, {
      orgId: intent.orgId,
      keyId: intent.keyId,
      tool,
      args: intent.args,
      intentId: intent.id,
    });
    confirmationToken = issued.token;
  }

  const { data: decided, error: decideError } = await admin
    .from("approval_intents")
    .update({
      status: input.decision,
      confirmation_token: confirmationToken,
      decided_by: input.decidedBy,
      decided_at: new Date().toISOString(),
      reason: input.reason ?? null,
    })
    .eq("id", intent.id)
    .eq("status", "pending")
    .select("*")
    .single();
  if (decideError) throw decideError;
  const final = rowToIntent(decided as Record<string, unknown>);
  if (input.decision === "denied") {
    // Belt and suspenders: no token should exist for a pending intent, but if
    // one does (minted before this fix, or a future regression), a Deny must
    // kill it. Redemption also verifies intent status, so this is defense in
    // depth rather than the only guard.
    await revokeConfirmationsForIntent(admin, intent.id);
  }
  void deliverDecisionWebhook(admin, final);
  return { ok: true, intent: final };
}

/** Attaches (or replaces) the agent's callback URL on a pending intent. */
export async function attachIntentCallback(
  admin: SupabaseClient,
  input: { intentId: string; orgId: string; callbackUrl: string },
): Promise<ApprovalIntent | null> {
  const clean = sanitizeCallbackUrl(input.callbackUrl);
  if (!clean) return null;
  const { data, error } = await admin
    .from("approval_intents")
    .update({ callback_url: clean })
    .eq("id", input.intentId)
    .eq("org_id", input.orgId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data ? rowToIntent(data as Record<string, unknown>) : null;
}

/** HMAC-SHA256 signature for decision webhooks: `sha256=<hex>`. */
export async function signWebhook(secret: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return `sha256=${Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * POSTs the decision to the agent's callback URL. Fire-and-forget by design:
 * a dead agent endpoint must never block or fail the human's decision.
 */
export async function deliverDecisionWebhook(
  admin: SupabaseClient,
  intent: ApprovalIntent,
): Promise<void> {
  if (!intent.callbackUrl) return;
  try {
    const policy = await getApprovalPolicy(admin, intent.orgId);
    const payload = {
      event: "approval.decided",
      intent_id: intent.id,
      tool_name: intent.toolName,
      status: intent.status,
      credits: intent.credits,
      preview: intent.preview,
      // Present only on approval: the single-use token, bound to these args.
      confirmation_token: intent.status === "approved" ? intent.confirmationToken : null,
      decided_by: intent.decidedBy,
      decided_at: intent.decidedAt,
      reason: intent.reason,
    };
    const raw = JSON.stringify(payload);
    const signature = await signWebhook(policy.webhookSecret, raw);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      await fetch(intent.callbackUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-relay-signature": signature,
          "x-relay-event": "approval.decided",
        },
        body: raw,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.log(
      JSON.stringify({
        event: "approval_webhook_failed",
        at: new Date().toISOString(),
        intentId: intent.id,
        message: e instanceof Error ? e.message : "webhook delivery failed",
      }),
    );
  }
}

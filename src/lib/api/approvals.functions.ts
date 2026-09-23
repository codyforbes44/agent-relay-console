import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  decideApprovalIntent,
  getApprovalPolicy,
  listApprovalIntentsForOrg,
  toApprovalIntentView,
  upsertApprovalPolicy,
  type ApprovalStatus,
} from "@/lib/api/approvals.server";

const orgIdSchema = z.object({ orgId: z.string().uuid() });

export type Membership = { org_id: string; role: string };

/** Throws unless the authenticated user belongs to the workspace. */
export async function requireMembership(
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
): Promise<Membership> {
  const { data, error } = await supabase
    .from("org_members")
    .select("org_id, role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("You are not a member of this workspace");
  return data as Membership;
}

/** Policy changes (like other workspace settings) are owner/admin only. */
export function requireManagerRole(role: string) {
  if (role !== "owner" && role !== "admin") {
    throw new Error("Only workspace owners and admins can change the approval policy");
  }
}

function describeDecisionFailure(
  code: "approval_not_found" | "approval_not_pending" | "approval_expired" | "unknown_tool",
): string {
  switch (code) {
    case "approval_not_found":
      return "Approval request not found in this workspace";
    case "approval_not_pending":
      return "This request was already decided";
    case "approval_expired":
      return "This request expired before it was decided";
    case "unknown_tool":
      return "The requested tool no longer exists";
  }
}

const statusSchema = z.enum(["pending", "approved", "denied", "expired", "cancelled", "all"]);

export const listApprovalIntents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; status?: string }) =>
    orgIdSchema.extend({ status: statusSchema.optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireMembership(context.supabase, context.userId, data.orgId);
    const intents = await listApprovalIntentsForOrg(
      supabaseAdmin,
      data.orgId,
      (data.status ?? "pending") as ApprovalStatus | "all",
    );
    return intents.map(toApprovalIntentView);
  });

const decisionSchema = orgIdSchema.extend({ intentId: z.string().uuid() });

function decidedBy(context: { userId: string; claims?: Record<string, unknown> }): string {
  const email = context.claims?.["email"];
  return typeof email === "string" && email ? email : context.userId;
}

export const approveIntent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; intentId: string }) => decisionSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireMembership(context.supabase, context.userId, data.orgId);
    const result = await decideApprovalIntent(supabaseAdmin, {
      intentId: data.intentId,
      orgId: data.orgId,
      decision: "approved",
      decidedBy: decidedBy(context),
    });
    if (!result.ok) throw new Error(describeDecisionFailure(result.code));
    return { ok: true as const, intent: toApprovalIntentView(result.intent) };
  });

export const denyIntent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; intentId: string; reason?: string }) =>
    decisionSchema.extend({ reason: z.string().trim().max(500).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireMembership(context.supabase, context.userId, data.orgId);
    const result = await decideApprovalIntent(supabaseAdmin, {
      intentId: data.intentId,
      orgId: data.orgId,
      decision: "denied",
      decidedBy: decidedBy(context),
      reason: data.reason || null,
    });
    if (!result.ok) throw new Error(describeDecisionFailure(result.code));
    return { ok: true as const, intent: toApprovalIntentView(result.intent) };
  });

export const fetchApprovalPolicy = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string }) => orgIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireMembership(context.supabase, context.userId, data.orgId);
    return getApprovalPolicy(supabaseAdmin, data.orgId);
  });

export const saveApprovalPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      orgId: string;
      autoApproveMaxCredits: number | null;
      autoApproveTools: string[];
      requireHumanTools: string[];
      defaultAction: string;
      notifyEmail: string | null;
    }) =>
      orgIdSchema
        .extend({
          autoApproveMaxCredits: z.number().int().min(0).max(1_000_000).nullable(),
          autoApproveTools: z.array(z.string().trim().min(1).max(64)).max(100),
          requireHumanTools: z.array(z.string().trim().min(1).max(64)).max(100),
          defaultAction: z.enum(["human", "auto"]),
          notifyEmail: z.string().trim().max(200).nullable(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const membership = await requireMembership(context.supabase, context.userId, data.orgId);
    requireManagerRole(membership.role);
    const notifyEmail = data.notifyEmail && data.notifyEmail.length > 0 ? data.notifyEmail : null;
    if (notifyEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notifyEmail)) {
      throw new Error("Notify email does not look like an email address");
    }
    return upsertApprovalPolicy(supabaseAdmin, data.orgId, {
      autoApproveMaxCredits: data.autoApproveMaxCredits ?? 0,
      autoApproveTools: data.autoApproveTools,
      requireHumanTools: data.requireHumanTools,
      defaultAction: data.defaultAction,
      notifyEmail,
    });
  });

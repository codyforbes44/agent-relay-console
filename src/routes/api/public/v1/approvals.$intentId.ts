import { createFileRoute } from "@tanstack/react-router";

import {
  attachIntentCallback,
  getApprovalIntentForOrg,
  type ApprovalIntent,
} from "@/lib/api/approvals.server";
import { apiError, json, preflight } from "@/lib/api/catalog.server";
import { authenticateAgentKey, readBearer } from "@/lib/api/keys.server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Public shape of an intent for the polling agent. The raw confirmation token
 *  is revealed only once the intent is approved — it is single-use and bound
 *  to the exact previewed args. */
function publicIntent(intent: ApprovalIntent) {
  return {
    intent_id: intent.id,
    status: intent.status,
    policy_decision: intent.policyDecision,
    tool_name: intent.toolName,
    tool_label: intent.toolLabel,
    preview: intent.preview,
    credits: intent.credits,
    expires_at: intent.expiresAt,
    created_at: intent.createdAt,
    decided_at: intent.decidedAt,
    decided_by: intent.decidedBy,
    reason: intent.reason,
    callback_url: intent.callbackUrl,
    // Null until a human (or policy) approves; then the agent retries the
    // original tool call with x-confirmation-token: <this value>.
    confirmation_token: intent.status === "approved" ? intent.confirmationToken : null,
  };
}

export const Route = createFileRoute("/api/public/v1/approvals/$intentId")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),

      /** Poll an approval intent. The agent retries its tool call once approved. */
      GET: async ({ params, request }) => {
        const raw = readBearer(request);
        if (!raw)
          return apiError(401, "missing_api_key", "Provide Authorization: Bearer sk_agent_...");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const identity = await authenticateAgentKey(supabaseAdmin, raw);
        if (!identity) return apiError(401, "invalid_api_key", "API key is invalid or revoked");
        if (!identity.scopes.includes("tools:invoke")) {
          return apiError(403, "insufficient_scope", "This key cannot invoke tools");
        }
        if (!UUID_RE.test(params.intentId)) {
          return apiError(
            404,
            "approval_intent_not_found",
            "No approval intent with that id exists in this workspace.",
          );
        }
        const intent = await getApprovalIntentForOrg(
          supabaseAdmin,
          identity.orgId,
          params.intentId,
        );
        if (!intent) {
          return apiError(
            404,
            "approval_intent_not_found",
            "No approval intent with that id exists in this workspace.",
          );
        }
        return json({ ok: true, approval: publicIntent(intent) });
      },

      /** Attach (or replace) a callback URL; the decision POSTs there signed. */
      POST: async ({ params, request }) => {
        const raw = readBearer(request);
        if (!raw)
          return apiError(401, "missing_api_key", "Provide Authorization: Bearer sk_agent_...");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const identity = await authenticateAgentKey(supabaseAdmin, raw);
        if (!identity) return apiError(401, "invalid_api_key", "API key is invalid or revoked");
        if (!identity.scopes.includes("tools:invoke")) {
          return apiError(403, "insufficient_scope", "This key cannot invoke tools");
        }
        if (!UUID_RE.test(params.intentId)) {
          return apiError(
            404,
            "approval_intent_not_found",
            "No approval intent with that id exists in this workspace.",
          );
        }
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return apiError(422, "invalid_json", "Request body must be JSON");
        }
        const callbackUrl =
          body && typeof body === "object"
            ? (body as Record<string, unknown>)["callback_url"]
            : null;
        if (typeof callbackUrl !== "string" || !callbackUrl.trim()) {
          return apiError(422, "invalid_input", "Body must include { callback_url: string }");
        }
        const intent = await attachIntentCallback(supabaseAdmin, {
          intentId: params.intentId,
          orgId: identity.orgId,
          callbackUrl,
        });
        if (!intent) {
          return apiError(
            422,
            "invalid_input",
            "Intent not found, no longer pending, or the callback URL was rejected (https only, http allowed for loopback).",
          );
        }
        return json({ ok: true, intent_id: intent.id, callback_accepted: true });
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { apiError, json, preflight } from "@/lib/api/catalog.server";
import { authenticateAgentKey, readBearer } from "@/lib/api/keys.server";
import { listConnections, revokeConnection } from "@/lib/api/oauth.server";

/** Agent-facing connection management: list the workspace's OAuth connections, revoke one. */
export const Route = createFileRoute("/api/public/v1/oauth/connections")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),

      GET: async ({ request }) => {
        const raw = readBearer(request);
        if (!raw)
          return apiError(401, "missing_api_key", "Provide Authorization: Bearer sk_agent_...");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const identity = await authenticateAgentKey(supabaseAdmin, raw);
        if (!identity) return apiError(401, "invalid_api_key", "API key is invalid or revoked");
        if (!identity.scopes.includes("tools:invoke")) {
          return apiError(403, "insufficient_scope", "This key cannot invoke tools");
        }

        try {
          const connections = await listConnections(supabaseAdmin, identity.orgId);
          return json({ ok: true, connections });
        } catch (e) {
          return apiError(
            500,
            "connections_unavailable",
            e instanceof Error ? e.message : "Could not list connections",
          );
        }
      },

      DELETE: async ({ request }) => {
        const raw = readBearer(request);
        if (!raw)
          return apiError(401, "missing_api_key", "Provide Authorization: Bearer sk_agent_...");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const identity = await authenticateAgentKey(supabaseAdmin, raw);
        if (!identity) return apiError(401, "invalid_api_key", "API key is invalid or revoked");
        if (!identity.scopes.includes("tools:invoke")) {
          return apiError(403, "insufficient_scope", "This key cannot invoke tools");
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return apiError(422, "invalid_json", "Request body must be JSON");
        }
        const parsed = z.object({ connection_id: z.string().uuid() }).safeParse(body);
        if (!parsed.success) {
          return apiError(422, "invalid_input", "Body must be { connection_id: <uuid> }");
        }

        try {
          const revoked = await revokeConnection(
            supabaseAdmin,
            identity.orgId,
            parsed.data.connection_id,
          );
          if (!revoked) {
            return apiError(404, "connection_not_found", "No such connection in this workspace");
          }
          return json({ ok: true, revoked: parsed.data.connection_id });
        } catch (e) {
          return apiError(
            500,
            "revoke_failed",
            e instanceof Error ? e.message : "Could not revoke the connection",
          );
        }
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { apiError, json, preflight } from "@/lib/api/catalog.server";
import { SIGNUP_FREE_CREDITS, SIGNUP_MAX_PER_IP, SIGNUP_WINDOW_HOURS } from "@/lib/api/onboarding";
import {
  clientIp,
  consumeSignupQuota,
  createAgentWorkspace,
  createClaimToken,
} from "@/lib/api/signup.server";

const bodySchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  email: z.string().trim().email().max(255).optional(),
});

/**
 * Agent self-serve signup. No human, no browser, no email verification.
 * Returns a one-time API key, a starter credit grant and a claim URL the
 * agent can hand to its operator when it needs to buy more credits.
 */
export const Route = createFileRoute("/api/public/v1/signup")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request }) => {
        let raw: unknown = {};
        try {
          const text = await request.text();
          raw = text ? JSON.parse(text) : {};
        } catch {
          return apiError(422, "invalid_json", "Request body must be valid JSON");
        }

        const parsed = bodySchema.safeParse(raw);
        if (!parsed.success) {
          return apiError(422, "validation_failed", "Invalid signup payload", {
            issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const allowed = await consumeSignupQuota(supabaseAdmin, clientIp(request));
        if (!allowed) {
          return apiError(
            429,
            "signup_rate_limited",
            `At most ${SIGNUP_MAX_PER_IP} workspaces may be created per ${SIGNUP_WINDOW_HOURS}h from one address.`,
          );
        }

        const origin = new URL(request.url).origin;
        try {
          const workspace = await createAgentWorkspace(supabaseAdmin, {
            label: parsed.data.label,
            email: parsed.data.email,
          });
          const claim = await createClaimToken(supabaseAdmin, workspace.orgId, origin);

          return json(
            {
              ok: true,
              orgId: workspace.orgId,
              apiKey: workspace.apiKey,
              keyPrefix: workspace.keyPrefix,
              credits: { granted: SIGNUP_FREE_CREDITS, balance: SIGNUP_FREE_CREDITS },
              claim: { url: claim.url, expiresAt: claim.expiresAt },
              next: {
                catalog: `${origin}/api/public/v1/tools`,
                openapi: `${origin}/api/public/v1/openapi.json`,
                account: `${origin}/api/public/v1/me`,
                mcp: `${origin}/mcp`,
                docs: `${origin}/docs`,
              },
              notice:
                "Store apiKey now — it is shown once. Share the claim URL with a human to unlock billing.",
            },
            201,
          );
        } catch {
          return apiError(500, "signup_failed", "Could not create a workspace right now");
        }
      },
    },
  },
});

import { zodToJsonSchema } from "zod-to-json-schema";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  PUBLIC_TOOLS,
  exampleSuccessEnvelope,
  type ToolContract,
} from "@/lib/agent/contracts";
import { TOOL_ERRORS } from "@/lib/api/errors";
import { visibleToolsForOrg } from "@/lib/api/org-tools.server";
import { pricingDocument } from "@/lib/api/pricing.server";
import { usdForCredits } from "@/lib/billing/packs";


export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, x-api-key, x-confirmation-token, idempotency-key, x-payment",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...CORS_HEADERS, ...extra } });
}

export function preflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function apiError(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
) {
  return json({ ok: false, error: { code, message, ...extra } }, status);
}

export function inputSchemaOf(tool: ToolContract) {
  return zodToJsonSchema(tool.schema, { target: "openApi3", $refStrategy: "none" }) as Record<
    string,
    unknown
  >;
}

/** OpenAPI responses for every error the tool endpoint can return. */
function errorResponses(sideEffecting: boolean) {
  const relevant = TOOL_ERRORS.filter((e) => sideEffecting || !e.code.startsWith("confirmation_"));
  const byStatus: Record<string, { description: string; content: unknown }> = {};
  for (const err of relevant) {
    const key = String(err.status);
    const line = `${err.code}: ${err.cause} → ${err.action}`;
    const existing = byStatus[key];
    byStatus[key] = {
      description: existing ? `${existing.description}\n${line}` : line,
      content: {
        "application/json": {
          examples: {
            ...((existing?.content as Record<string, { examples?: Record<string, unknown> }>)?.[
              "application/json"
            ]?.examples ?? {}),
            [err.code]: {
              summary: err.code,
              value: {
                ok: false,
                error: {
                  code: err.code,
                  message: err.cause,
                  ...(err.code === "insufficient_credits"
                    ? { required: 5, balance: 2 }
                    : {}),
                },
              },
            },
          },
        },
      },
    };
  }
  return byStatus;
}


export function toolDescriptor(tool: ToolContract, origin: string) {
  const headers: Record<string, string> = {
    Authorization: "Bearer sk_agent_...",
    "content-type": "application/json",
    "idempotency-key": "<unique-per-attempt>",
  };

  const invokeUrl = `${origin}/api/public/v1/tools/${tool.name}`;

  // Side-effecting tools are a deliberate two-step flow: the first call is
  // unconfirmed and returns a preview plus a single-use token bound to these
  // exact arguments. Never publish a pre-confirmed example.
  const confirmationFlow = tool.sideEffecting
    ? {
        required: true,
        header: "x-confirmation-token",
        steps: [
          {
            step: 1,
            description:
              "Call with no confirmation header. The response is 428 confirmation_required and carries error.preview plus error.confirmationToken.",
            request: { method: "POST", url: invokeUrl, headers, body: tool.example },
            response: {
              status: 428,
              body: {
                ok: false,
                error: {
                  code: "confirmation_required",
                  message:
                    "This tool has side effects. Show the preview to your operator, then retry the identical request with header 'x-confirmation-token: <confirmationToken>'.",
                  tool: tool.name,
                  credits: tool.credits,
                  preview: { summary: tool.summarize(tool.example), args: tool.example },
                  confirmationToken: "cnf_2f6c1a94b7d34e0f9a1c5e7d8b2f4a60",
                  expiresAt: "2026-08-09T20:25:18.358Z",
                },
              },
            },
          },
          {
            step: 2,
            description:
              "After a human approves the preview, repeat the identical body with the token. The token is single-use and bound to these arguments — changing the body returns 409 confirmation_mismatch.",
            request: {
              method: "POST",
              url: invokeUrl,
              headers: {
                ...headers,
                "x-confirmation-token": "cnf_2f6c1a94b7d34e0f9a1c5e7d8b2f4a60",
              },
              body: tool.example,
            },
            response: { status: 200, body: exampleSuccessEnvelope(tool) },
          },
        ],
      }
    : { required: false };

  return {
    confirmation: confirmationFlow,
    name: tool.name,
    label: tool.label,
    description: tool.description,
    sideEffecting: tool.sideEffecting,
    demo: tool.demo,
    credits: tool.credits,
    usdPerCall: usdForCredits(tool.credits),
    invokeUrl,
    inputSchema: inputSchemaOf(tool),
    example: {
      request: {
        method: "POST",
        url: `${origin}/api/public/v1/tools/${tool.name}`,
        headers,
        body: tool.example,
      },
      response: exampleSuccessEnvelope(tool),
      errors: TOOL_ERRORS.filter((e) => tool.sideEffecting || !e.code.startsWith("confirmation_")).map(
        (e) => ({ status: e.status, code: e.code, cause: e.cause, action: e.action }),
      ),
    },
  };
}


export function catalog(origin: string, tools: ToolContract[] = PUBLIC_TOOLS) {
  return {
    ok: true,
    version: "2026-08-09",
    confirmation: {
      header: "x-confirmation-token",
      flow: "Side-effecting tools: call unconfirmed -> 428 with error.preview + error.confirmationToken -> resend the identical body with the token. Tokens are single-use, expire in 10 minutes and are bound to the exact arguments previewed.",
    },
    docs: `${origin}/docs`,
    openapi: `${origin}/api/public/v1/openapi.json`,
    auth: {
      type: "bearer",
      header: "Authorization: Bearer sk_agent_...",
      signup: `${origin}/api/public/v1/signup`,
      signupMethod: "POST",
      humanSignup: `${origin}/auth`,
    },
    pricing: (() => {
      const p = pricingDocument(origin);
      return {
        unit: "credit",
        currency: "USD",
        usdPerCredit: p.usdPerCredit,
        freeGrant: p.freeGrant,
        packs: p.packs,
        pricingUrl: `${origin}/api/public/v1/pricing`,
        purchase: p.purchase,
      };
    })(),
    tools: tools.map((t) => toolDescriptor(t, origin)),
  };
}

/** Filtered catalog scoped to a workspace's enabled tools. */
export async function catalogForOrg(admin: SupabaseClient, origin: string, orgId: string) {
  const tools = await visibleToolsForOrg(admin, orgId);
  return { ...catalog(origin, tools), filteredForOrg: true };
}

export function openApiDocument(origin: string) {
  const paths: Record<string, unknown> = {};
  for (const tool of PUBLIC_TOOLS) {
    paths[`/api/public/v1/tools/${tool.name}`] = {
      post: {
        operationId: tool.name,
        summary: tool.label,
        description: `${tool.description} Costs ${tool.credits} credit(s).${
          tool.sideEffecting
            ? " Side-effecting: the first call returns 428 confirmation_required with a preview and a single-use confirmationToken; resend the identical body with header x-confirmation-token to execute."
            : ""
        }`,
        security: [{ agentKey: [] }],
        parameters: [
          {
            name: "idempotency-key",
            in: "header",
            required: false,
            schema: { type: "string" },
            description:
              "Replay-safe key scoped to your API key. A repeated completed call returns the stored response and is not charged again.",
          },
          ...(tool.sideEffecting
            ? [
                {
                  name: "x-confirmation-token",
                  in: "header",
                  required: false,
                  schema: { type: "string" },
                  description:
                    "Single-use token from a prior 428 confirmation_required response, bound to this exact request body. Omit it on the first call to receive the preview and token.",
                },
              ]
            : []),
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: inputSchemaOf(tool),
              examples: { default: { summary: "Example call", value: tool.example } },
            },
          },
        },
        responses: {
          "200": {
            description: "Tool result",
            content: {
              "application/json": {
                examples: {
                  default: { summary: "Success", value: exampleSuccessEnvelope(tool) },
                },
              },
            },
          },
          ...errorResponses(tool.sideEffecting),
        },


      },
    };
  }

  paths["/api/public/v1/signup"] = {
    post: {
      operationId: "signup",
      summary: "Create a workspace and API key (no auth required)",
      description:
        "Agent self-serve onboarding. Returns a one-time API key, a free starter credit grant and a claim URL for a human operator.",
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                label: { type: "string", maxLength: 80 },
                email: { type: "string", format: "email" },
              },
            },
          },
        },
      },
      responses: {
        "201": { description: "Workspace created; apiKey is shown once" },
        "422": { description: "Invalid signup payload" },
        "429": { description: "Too many workspaces created from this address" },
      },
    },
  };
  paths["/api/public/v1/claim"] = {
    post: {
      operationId: "createClaimLink",
      summary: "Mint a claim URL so a human can take ownership and buy credits",
      security: [{ agentKey: [] }],
      responses: {
        "200": { description: "Claim URL and expiry" },
        "401": { description: "Missing or invalid API key" },
        "409": { description: "Workspace already claimed" },
      },
    },
  };
  paths["/api/public/v1/keys/rotate"] = {
    post: {
      operationId: "rotateKey",
      summary: "Rotate the calling key (old key keeps working briefly)",
      security: [{ agentKey: [] }],
      responses: {
        "200": { description: "New apiKey, shown once" },
        "401": { description: "Missing or invalid API key" },
      },
    },
  };

  paths["/api/public/v1/credits/purchase"] = {
    post: {
      operationId: "purchaseCredits",
      summary: "Buy credits machine-to-machine over x402 (USDC on Base)",
      description:
        "POST {credits} to receive a 402 with an x402 accepts[] offer. Settle it, then retry the same request with an X-PAYMENT header to have the credits added.",
      security: [{ agentKey: [] }],
      responses: {
        "200": { description: "Credits added, with settlement receipt" },
        "402": { description: "Payment required — body carries the x402 offer" },
        "422": { description: "credits out of range" },
      },
    },
  };

  paths["/api/public/v1/me"] = {
    get: {
      operationId: "getAccount",
      summary: "Account, credit balance and rate limit",
      security: [{ agentKey: [] }],
      responses: { "200": { description: "Account status" } },
    },
  };
  paths["/api/public/v1/tools"] = {
    get: {
      operationId: "listTools",
      summary: "Machine-readable tool catalog (no auth required)",
      responses: { "200": { description: "Tool catalog" } },
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "Relay Agent Tool API",
      version: "2026-08-09",
      description:
        "Metered, agent-native tool API. Agents authenticate with a workspace API key and pay per call in credits.",
    },
    servers: [{ url: origin }],
    components: {
      securitySchemes: {
        agentKey: { type: "http", scheme: "bearer", bearerFormat: "sk_agent_..." },
      },
    },
    paths,
  };
}

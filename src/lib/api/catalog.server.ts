import { zodToJsonSchema } from "zod-to-json-schema";

import {
  PUBLIC_TOOLS,
  exampleSuccessEnvelope,
  type ToolContract,
} from "@/lib/agent/contracts";
import { ERROR_ENVELOPE_EXAMPLE, TOOL_ERRORS } from "@/lib/api/errors";


export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, x-api-key, x-confirm-side-effects, idempotency-key",
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

export function toolDescriptor(tool: ToolContract, origin: string) {
  const headers: Record<string, string> = {
    Authorization: "Bearer sk_agent_...",
    "content-type": "application/json",
    "idempotency-key": "<unique-per-attempt>",
  };
  if (tool.sideEffecting) headers["x-confirm-side-effects"] = "true";

  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    sideEffecting: tool.sideEffecting,
    demo: tool.demo,
    credits: tool.credits,
    invokeUrl: `${origin}/api/public/v1/tools/${tool.name}`,
    inputSchema: inputSchemaOf(tool),
    example: {
      request: {
        method: "POST",
        url: `${origin}/api/public/v1/tools/${tool.name}`,
        headers,
        body: tool.example,
      },
      response: exampleSuccessEnvelope(tool),
      errors: TOOL_ERRORS.filter((e) => tool.sideEffecting || e.code !== "confirmation_required").map(
        (e) => ({ status: e.status, code: e.code, cause: e.cause, action: e.action }),
      ),
    },
  };
}


export function catalog(origin: string) {
  return {
    ok: true,
    version: "2026-08-09",
    docs: `${origin}/docs`,
    openapi: `${origin}/api/public/v1/openapi.json`,
    auth: {
      type: "bearer",
      header: "Authorization: Bearer sk_agent_...",
      signup: `${origin}/api/public/v1/signup`,
      signupMethod: "POST",
      humanSignup: `${origin}/auth`,
    },
    pricing: { unit: "credit", freeGrant: 500 },
    tools: PUBLIC_TOOLS.map((t) => toolDescriptor(t, origin)),
  };
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
            ? " Side-effecting: send header x-confirm-side-effects: true to authorize execution."
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
                  name: "x-confirm-side-effects",
                  in: "header",
                  required: true,
                  schema: { type: "string", enum: ["true"] },
                  description: "Must be 'true' to authorize this side-effecting call.",
                },
              ]
            : []),
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: inputSchemaOf(tool) } },
        },
        responses: {
          "200": { description: "Tool result" },
          "401": { description: "Missing or invalid API key" },
          "402": { description: "Insufficient credits" },
          "403": { description: "Key lacks the tools:invoke scope" },
          "404": { description: "Unknown tool" },
          "409": { description: "A call with this idempotency-key is still running" },
          "422": { description: "Invalid JSON body or input validation failed" },
          "428": { description: "Side-effect confirmation header required" },
          "429": { description: "Rate limited (60 calls/minute per key)" },
          "502": { description: "Tool execution failed" },
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

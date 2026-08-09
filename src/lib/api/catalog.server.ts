import { zodToJsonSchema } from "zod-to-json-schema";

import { PUBLIC_TOOLS, type ToolContract } from "@/lib/agent/contracts";

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
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    sideEffecting: tool.sideEffecting,
    demo: tool.demo,
    credits: tool.credits,
    invokeUrl: `${origin}/api/public/v1/tools/${tool.name}`,
    inputSchema: inputSchemaOf(tool),
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
      signup: `${origin}/auth`,
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
        requestBody: {
          required: true,
          content: { "application/json": { schema: inputSchemaOf(tool) } },
        },
        responses: {
          "200": { description: "Tool result" },
          "401": { description: "Missing or invalid API key" },
          "402": { description: "Insufficient credits" },
          "422": { description: "Input validation failed" },
          "428": { description: "Side-effect confirmation header required" },
          "429": { description: "Rate limited" },
        },
      },
    };
  }

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

import { defineMcp, defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import type { z } from "zod";

import { TOOLS_BY_NAME, type ToolContract } from "@/lib/agent/contracts";
import { runTool } from "@/lib/agent/tools.server";
import { supabaseForUser } from "./supabase";

type Result = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function fail(text: string): Result {
  return { content: [{ type: "text", text }], isError: true };
}

/** Resolves the caller's workspace via RLS-scoped membership. */
async function resolveOrgId(ctx: ToolContext): Promise<string | null> {
  const supabase = supabaseForUser(ctx);
  const { data } = await supabase.from("org_members").select("org_id").limit(1).maybeSingle();
  return (data as { org_id?: string } | null)?.org_id ?? null;
}

/**
 * Runs a catalog tool for an authenticated MCP caller, metering credits
 * against their workspace exactly like the public REST API does.
 */
async function runMetered(
  contract: ToolContract,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<Result> {
  if (!ctx.isAuthenticated()) return fail("Not authenticated");

  const orgId = await resolveOrgId(ctx);
  if (!orgId) return fail("No workspace found for this account");

  const started = Date.now();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { getBalance, recordUsage } = await import("@/lib/api/metering.server");

  const balance = await getBalance(supabaseAdmin, orgId);
  if (balance < contract.credits) {
    return fail(
      `Insufficient credits: this call costs ${contract.credits}, balance is ${balance}. Top up in the Relay console.`,
    );
  }

  let result: Record<string, unknown>;
  try {
    result = await runTool(contract.name, args);
  } catch (e) {
    await recordUsage(supabaseAdmin, {
      orgId,
      keyId: "",
      toolName: contract.name,
      credits: 0,
      status: "error",
      errorCode: "tool_failed",
      latencyMs: Date.now() - started,
      requestId: crypto.randomUUID(),
    });
    return fail(e instanceof Error ? e.message : "Tool execution failed");
  }

  await recordUsage(supabaseAdmin, {
    orgId,
    keyId: "",
    toolName: contract.name,
    credits: contract.credits,
    status: "success",
    latencyMs: Date.now() - started,
    requestId: crypto.randomUUID(),
  });

  const payload = {
    ...result,
    demo: contract.demo,
    credits: { charged: contract.credits, balance: balance - contract.credits },
  };
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

type McpTool = Parameters<typeof defineMcp>[0]["tools"][number];

/** Builds an MCP tool from the shared typed contract registry. */
export function mcpToolFor(name: string): McpTool {
  const contract = TOOLS_BY_NAME[name];
  if (!contract) throw new Error(`Unknown tool contract: ${name}`);

  const shape = (contract.schema as unknown as z.ZodObject<z.ZodRawShape>).shape;

  return defineTool({
    name: contract.name,
    title: contract.label,
    description: [
      contract.description,
      `Costs ${contract.credits} credit(s) per call.`,
      `Example arguments: ${JSON.stringify(contract.example)}.`,
      `Example result: ${JSON.stringify(contract.exampleResult)}.`,
      contract.sideEffecting
        ? "Side-effecting: your client should ask the human to approve before calling."
        : "Read-only and safe to retry.",
    ].join(" "),
    inputSchema: shape,

    annotations: {
      readOnlyHint: !contract.sideEffecting,
      idempotentHint: !contract.sideEffecting,
      destructiveHint: contract.sideEffecting,
      openWorldHint: true,
    },
    handler: (args: Record<string, unknown>, ctx: ToolContext) => runMetered(contract, args, ctx),
  }) as unknown as McpTool;
}

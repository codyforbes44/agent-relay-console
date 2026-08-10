import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { streamText, stepCountIs, tool, type ModelMessage } from "ai";
import { z } from "zod";

import { createLovableAiGatewayProvider, getLovableAiGatewayRunId } from "@/lib/ai-gateway.server";
import { TOOL_CONTRACTS, TOOLS_BY_NAME, type AgentResponse, type ToolCallView } from "@/lib/agent/contracts";
import { recordToolTrace, runTool } from "@/lib/agent/tools.server";
import { getOrgSettings } from "@/lib/api/settings.server";

const DEFAULT_MODEL = "google/gemini-3.5-flash";
const RATE_LIMIT_PER_MINUTE = 20;

const TIER_MODELS: Record<string, string> = {
  economy: "google/gemini-3.1-flash-lite",
  balanced: "google/gemini-3.5-flash",
  quality: "google/gemini-3.1-pro-preview",
};

const RequestSchema = z.object({
  orgId: z.string().uuid(),
  conversationId: z.string().uuid().nullable().optional(),
  message: z.string().trim().min(1).max(8000).nullable().optional(),
  idempotencyKey: z.string().min(8).max(200),
  confirm: z
    .object({
      toolCallId: z.string().uuid(),
      approved: z.boolean(),
    })
    .nullable()
    .optional(),
});

type Log = Record<string, unknown>;
function log(event: string, fields: Log) {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...fields }));
}

function jsonError(status: number, error: string, extra: Partial<AgentResponse> = {}) {
  const body: AgentResponse = {
    conversationId: null,
    messageId: null,
    status: "error",
    content: "",
    toolCalls: [],
    error,
    ...extra,
  };
  return Response.json(body, { status });
}

function userClient(token: string): SupabaseClient {
  const url = process.env['SUPABASE_URL']!;
  const key = process.env['SUPABASE_PUBLISHABLE_KEY']!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        h.set("apikey", key);
        h.set("Authorization", `Bearer ${token}`);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

const SYSTEM_PROMPT = `You are the workspace agent for an internal operations team.
You can call typed tools. Read-only tools run immediately.
Side-effecting tools (sandbox_send_email, sandbox_update_crm_record, sandbox_create_payment, sandbox_delete_record) are NOT executed
when you call them: they are queued for explicit human approval. When a tool returns
status "awaiting_confirmation", stop, do not retry it, and tell the user in one short sentence
what you are about to do and that you need their approval.
Be concise. Use markdown. Never invent tool results.`;

export const Route = createFileRoute("/api/agent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const requestId = crypto.randomUUID();
        const started = Date.now();

        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.toLowerCase().startsWith("bearer ")
          ? authHeader.slice(7).trim()
          : "";
        if (!token) return jsonError(401, "Not signed in");

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return jsonError(400, "Invalid JSON body");
        }
        const parsed = RequestSchema.safeParse(raw);
        if (!parsed.success) {
          return jsonError(400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
        }
        const input = parsed.data;
        if (!input.message && !input.confirm) {
          return jsonError(400, "Either a message or a tool confirmation is required");
        }

        const supabase = userClient(token);
        const { data: userData, error: userError } = await supabase.auth.getUser(token);
        const user = userData?.user;
        if (userError || !user) return jsonError(401, "Session expired, please sign in again");

        const { data: membership } = await supabase
          .from("org_members")
          .select("org_id")
          .eq("org_id", input.orgId)
          .eq("user_id", user.id)
          .maybeSingle();
        if (!membership) return jsonError(403, "You are not a member of this workspace");

        const { data: allowed, error: rlError } = await supabase.rpc("consume_rate_limit", {
          _max: RATE_LIMIT_PER_MINUTE,
        });
        if (rlError) return jsonError(500, "Rate limiter unavailable");
        if (!allowed) {
          log("agent.rate_limited", { requestId, userId: user.id, orgId: input.orgId });
          return jsonError(429, "Rate limit reached. Wait a minute and try again.");
        }

        // Idempotency: first writer wins, replays return the stored response.
        const { error: idemError } = await supabase
          .from("idempotency_keys")
          .insert({ key: input.idempotencyKey, user_id: user.id, org_id: input.orgId });
        if (idemError) {
          const { data: existing } = await supabase
            .from("idempotency_keys")
            .select("response")
            .eq("key", input.idempotencyKey)
            .eq("user_id", user.id)
            .maybeSingle();
          if (existing?.response) {
            log("agent.idempotent_replay", { requestId, userId: user.id });
            return Response.json(existing.response as AgentResponse, { status: 200 });
          }
          return jsonError(409, "This request is already in progress");
        }

        const finish = async (response: AgentResponse) => {
          await supabase
            .from("idempotency_keys")
            .update({ response })
            .eq("key", input.idempotencyKey)
            .eq("user_id", user.id);
        };

        // Resolve conversation
        let conversationId = input.conversationId ?? null;
        if (!conversationId) {
          const title = (input.message ?? "New conversation").slice(0, 60);
          const { data: convo, error } = await supabase
            .from("conversations")
            .insert({ org_id: input.orgId, user_id: user.id, title })
            .select("id")
            .single();
          if (error || !convo) return jsonError(500, "Could not start a conversation");
          conversationId = convo.id as string;
        } else {
          const { data: convo } = await supabase
            .from("conversations")
            .select("id")
            .eq("id", conversationId)
            .maybeSingle();
          if (!convo) return jsonError(404, "Conversation not found");
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const orgSettings = await getOrgSettings(supabaseAdmin, input.orgId);

        const { data: job } = await supabase
          .from("jobs")
          .insert({ org_id: input.orgId, conversation_id: conversationId, status: "running" })
          .select("id")
          .single();
        const jobId = job?.id as string | undefined;

        const emittedToolCalls: ToolCallView[] = [];
        const resolvedModel =
          orgSettings.defaultModel && orgSettings.defaultModel !== "auto"
            ? orgSettings.defaultModel
            : (TIER_MODELS[orgSettings.costQualityTier] ?? DEFAULT_MODEL);

        // Handle a confirmation decision before running the model again.
        if (input.confirm) {
          const { data: pending } = await supabase
            .from("tool_calls")
            .select("*")
            .eq("id", input.confirm.toolCallId)
            .eq("conversation_id", conversationId)
            .maybeSingle();
          if (!pending) return jsonError(404, "Tool call not found");
          if (pending.status !== "awaiting_confirmation") {
            return jsonError(409, "This tool call was already decided");
          }

          if (!input.confirm.approved) {
            await supabase
              .from("tool_calls")
              .update({ status: "denied", decided_at: new Date().toISOString(), decided_by: user.id })
              .eq("id", pending.id);
            await supabase.from("audit_logs").insert({
              org_id: input.orgId,
              user_id: user.id,
              action: "tool.denied",
              tool_name: pending.tool_name,
              payload: { toolCallId: pending.id, args: pending.args, requestId },
            });
            emittedToolCalls.push({
              id: pending.id,
              toolName: pending.tool_name,
              args: pending.args ?? {},
              result: null,
              status: "denied",
              sideEffecting: true,
              error: null,
            });
          } else {
            await supabase.from("audit_logs").insert({
              org_id: input.orgId,
              user_id: user.id,
              action: "tool.approved",
              tool_name: pending.tool_name,
              payload: { toolCallId: pending.id, args: pending.args, requestId },
            });
            try {
              const result = await runTool(pending.tool_name, pending.args ?? {});
              await supabase
                .from("tool_calls")
                .update({
                  status: "success",
                  result,
                  decided_at: new Date().toISOString(),
                  decided_by: user.id,
                })
                .eq("id", pending.id);
              await supabase.from("audit_logs").insert({
                org_id: input.orgId,
                user_id: user.id,
                action: "tool.executed",
                tool_name: pending.tool_name,
                payload: { toolCallId: pending.id, result, requestId },
              });
              emittedToolCalls.push({
                id: pending.id,
                toolName: pending.tool_name,
                args: pending.args ?? {},
                result,
                status: "success",
                sideEffecting: true,
                error: null,
              });
            } catch (e) {
              const message = e instanceof Error ? e.message : "Tool failed";
              await supabase
                .from("tool_calls")
                .update({ status: "error", error: message, decided_at: new Date().toISOString(), decided_by: user.id })
                .eq("id", pending.id);
              await supabase.from("audit_logs").insert({
                org_id: input.orgId,
                user_id: user.id,
                action: "tool.failed",
                tool_name: pending.tool_name,
                payload: { toolCallId: pending.id, error: message, requestId },
              });
              emittedToolCalls.push({
                id: pending.id,
                toolName: pending.tool_name,
                args: pending.args ?? {},
                result: null,
                status: "error",
                sideEffecting: true,
                error: message,
              });
            }
          }
        }

        if (input.message) {
          await supabase.from("messages").insert({
            conversation_id: conversationId,
            org_id: input.orgId,
            user_id: user.id,
            role: "user",
            content: input.message,
          });
          await supabase
            .from("conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", conversationId);
        }

        // Build model history from persisted messages.
        const { data: history } = await supabase
          .from("messages")
          .select("role, content")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true })
          .limit(60);

        const modelMessages: ModelMessage[] = (history ?? []).map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        })) as ModelMessage[];

        for (const call of emittedToolCalls) {
          modelMessages.push({
            role: "user",
            content:
              call.status === "denied"
                ? `[system] The user DENIED the ${call.toolName} action. Do not retry it. Acknowledge briefly and offer alternatives.`
                : call.status === "error"
                  ? `[system] The ${call.toolName} action was approved but failed: ${call.error}. Explain briefly.`
                  : `[system] The user APPROVED the ${call.toolName} action and it executed successfully. Result: ${JSON.stringify(call.result)}. Confirm to the user in one short sentence.`,
          });
        }

        const apiKey = process.env['LOVABLE_API_KEY'];
        if (!apiKey) {
          await finish({
            conversationId,
            messageId: null,
            status: "error",
            content: "",
            toolCalls: emittedToolCalls,
            error: "AI is not configured for this workspace",
          });
          return jsonError(500, "AI is not configured for this workspace", { conversationId });
        }

        const gateway = createLovableAiGatewayProvider(apiKey, getLovableAiGatewayRunId(request));

        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const send = (payload: unknown) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            };

            const pendingConfirmations: ToolCallView[] = [];
            let text = "";
            let failure: string | null = null;
            let cancelled = false;

            for (const call of emittedToolCalls) send({ type: "tool", toolCall: call });

            const tools = Object.fromEntries(
              TOOL_CONTRACTS.map((contract) => [
                contract.name,
                tool({
                  description: contract.description,
                  inputSchema: contract.schema,
                  execute: async (args: Record<string, unknown>) => {
                    const toolStarted = Date.now();
                    const toolStartedAt = new Date();
                    if (contract.sideEffecting) {
                      const { data: row } = await supabase
                        .from("tool_calls")
                        .insert({
                          org_id: input.orgId,
                          conversation_id: conversationId,
                          tool_name: contract.name,
                          args,
                          status: "awaiting_confirmation",
                          side_effecting: true,
                        })
                        .select("id")
                        .single();
                      const view: ToolCallView = {
                        id: (row?.id as string) ?? crypto.randomUUID(),
                        toolName: contract.name,
                        args,
                        result: null,
                        status: "awaiting_confirmation",
                        sideEffecting: true,
                        error: null,
                      };
                      pendingConfirmations.push(view);
                      send({ type: "tool", toolCall: view });
                      await supabase.from("audit_logs").insert({
                        org_id: input.orgId,
                        user_id: user.id,
                        action: "tool.proposed",
                        tool_name: contract.name,
                        payload: { toolCallId: view.id, args, requestId },
                      });
                      log("agent.tool_proposed", {
                        requestId,
                        orgId: input.orgId,
                        userId: user.id,
                        conversationId,
                        tool: contract.name,
                      });
                      return {
                        status: "awaiting_confirmation",
                        note: "Queued for human approval. Do not retry.",
                      };
                    }

                    let result: Record<string, unknown>;
                    let status: ToolCallView["status"] = "success";
                    let error: string | null = null;
                    try {
                      result = await runTool(contract.name, { ...args, orgId: input.orgId });
                    } catch (e) {
                      error = e instanceof Error ? e.message : "Tool failed";
                      status = "error";
                      result = { ok: false, error };
                    }
                    const { data: row } = await supabase
                      .from("tool_calls")
                      .insert({
                        org_id: input.orgId,
                        conversation_id: conversationId,
                        tool_name: contract.name,
                        args,
                        result,
                        status,
                        error,
                        side_effecting: false,
                      })
                      .select("id")
                      .single();
                    const view: ToolCallView = {
                      id: (row?.id as string) ?? crypto.randomUUID(),
                      toolName: contract.name,
                      args,
                      result,
                      status,
                      sideEffecting: false,
                      error,
                    };
                    emittedToolCalls.push(view);
                    send({ type: "tool", toolCall: view });
                    log("agent.tool_executed", {
                      requestId,
                      orgId: input.orgId,
                      userId: user.id,
                      conversationId,
                      tool: contract.name,
                      status,
                      ms: Date.now() - toolStarted,
                    });
                    void recordToolTrace({
                      orgId: input.orgId,
                      requestId,
                      toolName: contract.name,
                      args,
                      result,
                      error,
                      durationMs: Date.now() - toolStartedAt.getTime(),
                      startedAt: toolStartedAt,
                    });
                    return result;
                  },
                }),
              ]),
            );

            try {
              const result = streamText({
                model: gateway(resolvedModel),
                system: SYSTEM_PROMPT,
                messages: modelMessages,
                tools,
                stopWhen: stepCountIs(50),
                abortSignal: request.signal,
              });

              for await (const part of result.fullStream) {
                if (part.type === "text-delta") {
                  text += part.text;
                  send({ type: "delta", text: part.text });
                } else if (part.type === "error") {
                  failure = part.error instanceof Error ? part.error.message : String(part.error);
                }
              }
            } catch (e) {
              if (request.signal.aborted) {
                cancelled = true;
              } else {
                failure = e instanceof Error ? e.message : "The agent run failed";
              }
            }

            const status: AgentResponse["status"] = cancelled
              ? "cancelled"
              : failure
                ? "error"
                : pendingConfirmations.length > 0
                  ? "awaiting_confirmation"
                  : "complete";

            let messageId: string | null = null;
            if (text || failure || status === "awaiting_confirmation") {
              const { data: saved } = await supabase
                .from("messages")
                .insert({
                  conversation_id: conversationId,
                  org_id: input.orgId,
                  role: "assistant",
                  content: text,
                  status,
                  error: failure,
                })
                .select("id")
                .single();
              messageId = (saved?.id as string) ?? null;
              if (messageId) {
                const ids = [...emittedToolCalls, ...pendingConfirmations].map((c) => c.id);
                if (ids.length) {
                  await supabase.from("tool_calls").update({ message_id: messageId }).in("id", ids);
                }
              }
            }

            if (jobId) {
              await supabase
                .from("jobs")
                .update({
                  status:
                    status === "awaiting_confirmation"
                      ? "awaiting_confirmation"
                      : status === "complete"
                        ? "succeeded"
                        : status,
                  error: failure,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", jobId);
            }

            await supabase
              .from("conversations")
              .update({ updated_at: new Date().toISOString() })
              .eq("id", conversationId);

            const response: AgentResponse = {
              conversationId,
              messageId,
              status,
              content: text,
              toolCalls: [...emittedToolCalls, ...pendingConfirmations],
              error: failure,
            };
            await finish(response);
            log("agent.finished", {
              requestId,
              orgId: input.orgId,
              userId: user.id,
              conversationId,
              messageId,
              status,
              tools: response.toolCalls.length,
              ms: Date.now() - started,
            });

            send({ type: "final", ...response });
            controller.close();
          },
        });

        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
          },
        });
      },
    },
  },
});

export type { AgentResponse };
export { TOOLS_BY_NAME };

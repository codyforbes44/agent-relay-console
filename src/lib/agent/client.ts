import { supabase } from "@/integrations/supabase/client";
import type { AgentResponse, ToolCallView } from "./contracts";

export type AgentRequest = {
  orgId: string;
  conversationId?: string | null;
  message?: string | null;
  idempotencyKey: string;
  confirm?: { toolCallId: string; approved: boolean } | null;
};

export type AgentHandlers = {
  onDelta?: (text: string) => void;
  onToolCall?: (toolCall: ToolCallView) => void;
  signal?: AbortSignal;
};

export function newIdempotencyKey() {
  return crypto.randomUUID();
}

/**
 * The single client -> server entry point for the agent.
 * No model provider or third-party credentials exist in the browser.
 */
export async function streamAgent(
  body: AgentRequest,
  { onDelta, onToolCall, signal }: AgentHandlers = {},
): Promise<AgentResponse> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    return {
      conversationId: body.conversationId ?? null,
      messageId: null,
      status: "error",
      content: "",
      toolCalls: [],
      error: "Your session expired. Sign in again.",
    };
  }

  let response: Response;
  try {
    response = await fetch("/api/agent", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch (e) {
    if (signal?.aborted) {
      return cancelled(body.conversationId ?? null);
    }
    return errorResponse(
      body.conversationId ?? null,
      e instanceof Error ? e.message : "Network error — check your connection.",
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    try {
      return (await response.json()) as AgentResponse;
    } catch {
      return errorResponse(body.conversationId ?? null, `Request failed (${response.status})`);
    }
  }

  const reader = response.body?.getReader();
  if (!reader) return errorResponse(body.conversationId ?? null, "Empty response from the agent");

  const decoder = new TextDecoder();
  let buffer = "";
  let final: AgentResponse | null = null;
  let text = "";
  const toolCalls: ToolCallView[] = [];

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const line = chunk.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const payload = JSON.parse(line.slice(6)) as
          | { type: "delta"; text: string }
          | { type: "tool"; toolCall: ToolCallView }
          | ({ type: "final" } & AgentResponse);
        if (payload.type === "delta") {
          text += payload.text;
          onDelta?.(payload.text);
        } else if (payload.type === "tool") {
          toolCalls.push(payload.toolCall);
          onToolCall?.(payload.toolCall);
        } else if (payload.type === "final") {
          const { type: _type, ...rest } = payload;
          final = rest;
        }
      }
    }
  } catch (e) {
    if (signal?.aborted) {
      return { ...cancelled(body.conversationId ?? null), content: text, toolCalls };
    }
    return {
      ...errorResponse(body.conversationId ?? null, e instanceof Error ? e.message : "Stream failed"),
      content: text,
      toolCalls,
    };
  }

  return (
    final ?? {
      conversationId: body.conversationId ?? null,
      messageId: null,
      status: "complete",
      content: text,
      toolCalls,
      error: null,
    }
  );
}

function errorResponse(conversationId: string | null, error: string): AgentResponse {
  return { conversationId, messageId: null, status: "error", content: "", toolCalls: [], error };
}

function cancelled(conversationId: string | null): AgentResponse {
  return { conversationId, messageId: null, status: "cancelled", content: "", toolCalls: [], error: null };
}

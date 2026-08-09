import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, RotateCcw, ShieldQuestion } from "lucide-react";
import { toast } from "sonner";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import { ToolCallCard } from "@/components/workspace/ToolCallCard";
import { newIdempotencyKey, streamAgent } from "@/lib/agent/client";
import type { AgentStatus, ToolCallView } from "@/lib/agent/contracts";
import { threadMessagesQuery, type ChatMessage } from "@/lib/workspace/queries";

type RunState = {
  status: AgentStatus | "idle";
  text: string;
  toolCalls: ToolCallView[];
  error: string | null;
};

const IDLE: RunState = { status: "idle", text: "", toolCalls: [], error: null };

export function ChatWindow({ orgId, threadId }: { orgId: string; threadId: string | null }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [input, setInput] = useState("");
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [run, setRun] = useState<RunState>(IDLE);
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);

  const messagesQuery = useQuery({
    ...threadMessagesQuery(threadId ?? ""),
    enabled: Boolean(threadId),
  });
  const messages: ChatMessage[] = threadId ? (messagesQuery.data ?? []) : [];

  useEffect(() => {
    setRun(IDLE);
    setPendingUser(null);
    setInput("");
    textareaRef.current?.focus();
  }, [threadId]);

  const busy = run.status === "streaming";

  const execute = useCallback(
    async (payload: { message?: string; confirm?: { toolCallId: string; approved: boolean } }) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setRun({ status: "streaming", text: "", toolCalls: [], error: null });

      const response = await streamAgent(
        {
          orgId,
          conversationId: threadId,
          message: payload.message ?? null,
          confirm: payload.confirm ?? null,
          idempotencyKey: newIdempotencyKey(),
        },
        {
          signal: controller.signal,
          onDelta: (text) => setRun((r) => ({ ...r, text: r.text + text })),
          onToolCall: (toolCall) =>
            setRun((r) => ({
              ...r,
              toolCalls: [...r.toolCalls.filter((t) => t.id !== toolCall.id), toolCall],
            })),
        },
      );

      abortRef.current = null;
      setPendingUser(null);

      if (response.error) toast.error(response.error);

      if (response.conversationId) {
        await queryClient.invalidateQueries({ queryKey: ["threads", orgId] });
        await queryClient.invalidateQueries({ queryKey: ["messages", response.conversationId] });
        if (!threadId) {
          navigate({
            to: "/chat/$threadId",
            params: { threadId: response.conversationId },
            replace: true,
          });
          return;
        }
      }

      setRun({
        status: response.status,
        text: response.status === "error" || response.status === "cancelled" ? response.content : "",
        toolCalls: response.status === "error" ? response.toolCalls : [],
        error: response.error,
      });
    },
    [navigate, orgId, queryClient, threadId],
  );

  async function onSend(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    if (trimmed.length > 8000) {
      toast.error("Message is too long (8000 character limit).");
      return;
    }
    setInput("");
    setPendingUser(trimmed);
    setLastPrompt(trimmed);
    await execute({ message: trimmed });
    textareaRef.current?.focus();
  }

  function onCancel() {
    abortRef.current?.abort();
    abortRef.current = null;
    setRun({ status: "cancelled", text: "", toolCalls: [], error: null });
    setPendingUser(null);
  }

  const pendingApproval = messages
    .flatMap((m) => m.toolCalls)
    .concat(run.toolCalls)
    .find((c) => c.status === "awaiting_confirmation");

  return (
    <div className="flex h-full flex-col">
      <StatusStrip run={run} pendingApproval={Boolean(pendingApproval)} />

      <Conversation className="flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl">
          {messages.length === 0 && !pendingUser && !busy ? (
            <ConversationEmptyState
              icon={<ShieldQuestion className="size-6 text-primary" />}
              title="Start a run"
              description="Ask the agent to research, look up a contact, or draft an action. Anything that changes the outside world waits for your approval."
            />
          ) : null}

          {messages.map((message) => (
            <div key={message.id}>
              <Message from={message.role}>
                <MessageContent
                  className={
                    message.role === "assistant" ? "bg-transparent px-0 text-foreground" : undefined
                  }
                >
                  <MessageResponse>{message.content}</MessageResponse>
                </MessageContent>
              </Message>
              {message.toolCalls.length > 0 && (
                <div className="mt-2">
                  {message.toolCalls.map((call) => (
                    <ToolCallCard
                      key={call.id}
                      call={call}
                      busy={busy}
                      onDecision={(approved) =>
                        execute({ confirm: { toolCallId: call.id, approved } })
                      }
                    />
                  ))}
                </div>
              )}
              {message.error && <ErrorNote text={message.error} />}
            </div>
          ))}

          {pendingUser && (
            <Message from="user">
              <MessageContent>{pendingUser}</MessageContent>
            </Message>
          )}

          {run.toolCalls.length > 0 && (
            <div className="mt-2">
              {run.toolCalls.map((call) => (
                <ToolCallCard
                  key={call.id}
                  call={call}
                  busy={busy}
                  onDecision={(approved) => execute({ confirm: { toolCallId: call.id, approved } })}
                />
              ))}
            </div>
          )}

          {busy && (
            <Message from="assistant">
              <MessageContent className="bg-transparent px-0 text-foreground">
                {run.text ? (
                  <MessageResponse>{run.text}</MessageResponse>
                ) : (
                  <Shimmer>Thinking…</Shimmer>
                )}
              </MessageContent>
            </Message>
          )}

          {run.status === "error" && run.error && (
            <div className="flex flex-wrap items-center gap-3">
              <ErrorNote text={run.error} />
              {lastPrompt && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => {
                    setPendingUser(lastPrompt);
                    void execute({ message: lastPrompt });
                  }}
                >
                  <RotateCcw className="size-3.5" /> Retry
                </Button>
              )}
            </div>
          )}

          {run.status === "cancelled" && (
            <p className="text-sm text-muted-foreground">Run cancelled.</p>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t border-border bg-background px-4 py-4">
        <div className="mx-auto w-full max-w-3xl">
          <PromptInput
            onSubmit={(_message, event) => {
              event.preventDefault();
              void onSend(input);
            }}
          >
            <PromptInputTextarea
              ref={textareaRef}
              autoFocus
              value={input}
              placeholder="Ask the agent to do something…"
              onChange={(e) => setInput(e.target.value)}
            />
            <PromptInputFooter className="justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                POST /api/agent
              </span>
              <PromptInputSubmit
                status={busy ? "streaming" : "ready"}
                disabled={!busy && input.trim().length === 0}
                onStop={onCancel}
              />

            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}

function ErrorNote({ text }: { text: string }) {
  return (
    <div className="mt-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground">
      <AlertTriangle className="mt-0.5 size-4 text-destructive" />
      <span>{text}</span>
    </div>
  );
}

function StatusStrip({ run, pendingApproval }: { run: RunState; pendingApproval: boolean }) {
  const label =
    run.status === "streaming"
      ? run.toolCalls.length
        ? `Running tools (${run.toolCalls.length})`
        : "Generating response"
      : pendingApproval
        ? "Waiting for your approval"
        : run.status === "error"
          ? "Run failed"
          : run.status === "cancelled"
            ? "Run cancelled"
            : "Idle";

  const tone =
    run.status === "streaming"
      ? "bg-primary"
      : pendingApproval
        ? "bg-warning"
        : run.status === "error"
          ? "bg-destructive"
          : "bg-muted-foreground/50";

  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
      <span className={`size-2 rounded-full ${tone}`} />
      <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

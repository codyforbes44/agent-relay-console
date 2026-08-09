import { queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { ToolCallStatus, ToolCallView } from "@/lib/agent/contracts";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: string;
  error: string | null;
  createdAt: string;
  toolCalls: ToolCallView[];
};

export type Thread = {
  id: string;
  title: string;
  updatedAt: string;
};

export const orgQuery = () =>
  queryOptions({
    queryKey: ["org"],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Not signed in");

      const { data, error } = await supabase
        .from("org_members")
        .select("org_id, role, organizations(id, name)")
        // Super admins can read every membership row, so always scope to self.
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("No workspace found for this account");

      return {
        id: data.org_id,
        role: data.role,
        name: (data.organizations as { name: string } | null)?.name ?? "Workspace",
        userId,
      };
    },
    staleTime: 5 * 60 * 1000,
  });

export const threadsQuery = (orgId: string) =>
  queryOptions({
    queryKey: ["threads", orgId],
    queryFn: async (): Promise<Thread[]> => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, title, updated_at")
        .eq("org_id", orgId)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((c) => ({ id: c.id, title: c.title, updatedAt: c.updated_at }));
    },
  });

export const threadMessagesQuery = (conversationId: string) =>
  queryOptions({
    queryKey: ["messages", conversationId],
    queryFn: async (): Promise<ChatMessage[]> => {
      const [{ data: messages, error: mErr }, { data: calls, error: tErr }] = await Promise.all([
        supabase
          .from("messages")
          .select("id, role, content, status, error, created_at")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true }),
        supabase
          .from("tool_calls")
          .select("id, message_id, tool_name, args, result, status, side_effecting, error, created_at")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true }),
      ]);
      if (mErr) throw mErr;
      if (tErr) throw tErr;

      const byMessage = new Map<string, ToolCallView[]>();
      const orphans: ToolCallView[] = [];
      for (const c of calls ?? []) {
        const view: ToolCallView = {
          id: c.id,
          toolName: c.tool_name,
          args: (c.args ?? {}) as Record<string, unknown>,
          result: c.result,
          status: c.status as ToolCallStatus,
          sideEffecting: c.side_effecting,
          error: c.error,
        };
        if (c.message_id) {
          byMessage.set(c.message_id, [...(byMessage.get(c.message_id) ?? []), view]);
        } else {
          orphans.push(view);
        }
      }

      const rows = (messages ?? []).map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        status: m.status,
        error: m.error,
        createdAt: m.created_at,
        toolCalls: byMessage.get(m.id) ?? [],
      }));

      const lastAssistant = [...rows].reverse().find((r) => r.role === "assistant");
      if (lastAssistant && orphans.length) {
        lastAssistant.toolCalls = [...lastAssistant.toolCalls, ...orphans];
      }
      return rows;
    },
  });

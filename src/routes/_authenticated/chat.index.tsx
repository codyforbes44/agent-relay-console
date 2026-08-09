import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { ChatWindow } from "@/components/workspace/ChatWindow";
import { ThreadSidebar } from "@/components/workspace/ThreadSidebar";
import { orgQuery } from "@/lib/workspace/queries";

export const Route = createFileRoute("/_authenticated/chat/")({
  head: () => ({
    meta: [
      { title: "New run — Relay Agent Workspace" },
      { name: "description", content: "Start a new tenant-scoped AI agent conversation in Relay." },
      { property: "og:title", content: "New run — Relay Agent Workspace" },
      { property: "og:description", content: "Start a new AI agent conversation." },
    ],
  }),
  component: NewChat,
});

function NewChat() {
  return <Workspace threadId={null} />;
}

export function Workspace({ threadId }: { threadId: string | null }) {
  const { data: org, isLoading, error } = useQuery(orgQuery());

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !org) {
    return (
      <div className="flex h-screen items-center justify-center bg-background px-6 text-center">
        <p className="max-w-sm text-sm text-muted-foreground">
          We couldn't load your workspace. Refresh the page or sign in again.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      <ThreadSidebar orgId={org.id} orgName={org.name} activeThreadId={threadId} />
      <main className="min-w-0 flex-1">
        <ChatWindow orgId={org.id} threadId={threadId} />
      </main>
    </div>
  );
}

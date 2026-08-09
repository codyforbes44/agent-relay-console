import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import { ThreadSidebar } from "@/components/workspace/ThreadSidebar";
import { orgQuery } from "@/lib/workspace/queries";

/** Thin human console shell: the sidebar plus a scrollable content column. */
export function ConsoleShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: (org: { id: string; name: string }) => ReactNode;
}) {
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
        <p className="text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "Could not load your workspace."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      <ThreadSidebar orgId={org.id} orgName={org.name} activeThreadId={null} />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-6 py-10">
          <header className="mb-8">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </header>
          {children({ id: org.id, name: org.name })}
        </div>
      </main>
    </div>
  );
}

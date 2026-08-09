import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  MessageSquarePlus,
  LogOut,
  Loader2,
  KeyRound,
  BarChart3,
  BookOpen,
  CreditCard,
  ShieldCheck,
  Wrench,
  Settings,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { threadsQuery } from "@/lib/workspace/queries";
import { getIsSuperAdmin } from "@/lib/admin/admin.functions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ThreadSidebar({
  orgId,
  orgName,
  activeThreadId,
}: {
  orgId: string;
  orgName: string;
  activeThreadId: string | null;
}) {
  const { data: threads, isLoading } = useQuery(threadsQuery(orgId));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isSuperAdminFn = useServerFn(getIsSuperAdmin);
  const { data: adminFlag } = useQuery({
    queryKey: ["is-super-admin"],
    queryFn: () => isSuperAdminFn(),
    staleTime: 5 * 60_000,
  });

  const signOut = useMutation({
    mutationFn: async () => {
      await queryClient.cancelQueries();
      queryClient.clear();
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
    onSuccess: () => navigate({ to: "/auth", replace: true }),
    onError: () => toast.error("Could not sign out"),
  });

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="px-4 py-5">
        <span className="font-mono text-[11px] tracking-[0.3em] text-primary">RELAY</span>
        <p className="mt-1 truncate text-sm font-medium text-sidebar-foreground">{orgName}</p>
      </div>

      <div className="px-3">
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={() => navigate({ to: "/chat" })}
        >
          <MessageSquarePlus className="size-4" />
          New conversation
        </Button>
      </div>

      <nav className="mt-4 flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        <p className="px-2 pb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Conversations
        </p>
        {isLoading ? (
          <div className="flex items-center gap-2 px-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading
          </div>
        ) : threads?.length ? (
          threads.map((thread) => (
            <Link
              key={thread.id}
              to="/chat/$threadId"
              params={{ threadId: thread.id }}
              className={cn(
                "block truncate rounded-md px-2 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent",
                activeThreadId === thread.id &&
                  "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
              )}
            >
              {thread.title}
            </Link>
          ))
        ) : (
          <p className="px-2 text-sm text-muted-foreground">No conversations yet.</p>
        )}
      </nav>


      <div className="space-y-1 border-t border-sidebar-border p-3">
        <Link
          to="/keys"
          className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent"
        >
          <KeyRound className="size-4" />
          API keys
        </Link>
        <Link
          to="/tools"
          className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent"
        >
          <Wrench className="size-4" />
          Tool catalog
        </Link>
        <Link
          to="/settings"
          className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent"
        >
          <Settings className="size-4" />
          Workspace settings
        </Link>
        <Link
          to="/usage"
          className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent"
        >
          <BarChart3 className="size-4" />
          Usage &amp; credits
        </Link>
        <Link
          to="/billing"
          className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent"
        >
          <CreditCard className="size-4" />
          Buy credits
        </Link>
        {adminFlag?.isSuperAdmin && (
          <Link
            to="/admin"
            className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent"
          >
            <ShieldCheck className="size-4" />
            Super admin
          </Link>
        )}
        <Link
          to="/docs"
          className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent"
        >
          <BookOpen className="size-4" />
          API docs
        </Link>
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={() => signOut.mutate()}
          disabled={signOut.isPending}
        >
          <LogOut className="size-4" />
          Sign out
        </Button>
      </div>

    </aside>
  );
}

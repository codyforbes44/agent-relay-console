import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";

import { ConsoleShell } from "@/components/workspace/ConsoleShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAccountSummary } from "@/lib/api/keys.functions";

export const Route = createFileRoute("/_authenticated/usage")({
  head: () => ({
    meta: [
      { title: "Usage & credits — Relay Agent Tool API" },
      {
        name: "description",
        content: "Track per-call credit spend, tool usage and latency for your agent workspace.",
      },
      { property: "og:title", content: "Usage & credits — Relay Agent Tool API" },
      { property: "og:description", content: "Metering dashboard for agent tool calls." },
    ],
  }),
  component: UsagePage,
});

function UsagePage() {
  return (
    <ConsoleShell
      title="Usage & credits"
      description="Every machine call is metered. Credits are deducted per successful tool invocation."
    >
      {(org) => <UsagePanel orgId={org.id} />}
    </ConsoleShell>
  );
}

function UsagePanel({ orgId }: { orgId: string }) {
  const summary = useServerFn(getAccountSummary);
  const { data, isLoading, error } = useQuery({
    queryKey: ["usage", orgId],
    queryFn: () => summary({ data: { orgId } }),
    refetchInterval: 15_000,
  });

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Loading
      </p>
    );
  }
  if (error || !data) {
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : "Could not load usage"}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Credit balance" value={data.balance.toLocaleString()} />
        <Stat label="Recent calls" value={data.totalCalls.toLocaleString()} />
        <Stat label="Credits in recent calls" value={data.spentLast50.toLocaleString()} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent tool calls</CardTitle>
          <CardDescription>Last 50 metered events across all API keys.</CardDescription>
        </CardHeader>
        <CardContent>
          {!data.events.length ? (
            <p className="text-sm text-muted-foreground">
              No machine calls yet. Create an API key and POST to a tool endpoint.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {data.events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div>
                    <p className="font-mono text-sm text-foreground">{e.tool_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(e.created_at).toLocaleString()} · {e.latency_ms}ms
                      {e.error_code ? ` · ${e.error_code}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span
                      className={
                        e.status === "success"
                          ? "rounded-full bg-primary/10 px-2 py-0.5 text-primary"
                          : "rounded-full bg-muted px-2 py-0.5 text-muted-foreground"
                      }
                    >
                      {e.status}
                    </span>
                    <span className="font-mono text-muted-foreground">-{e.credits}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}

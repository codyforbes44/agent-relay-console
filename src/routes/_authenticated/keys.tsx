import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, KeyRound, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConsoleShell } from "@/components/workspace/ConsoleShell";
import { KeyLimitsEditor } from "@/components/workspace/KeyLimitsEditor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createAgentKey, listAgentKeys, revokeAgentKey } from "@/lib/api/keys.functions";

export const Route = createFileRoute("/_authenticated/keys")({
  head: () => ({
    meta: [
      { title: "API keys — Relay Agent Tool API" },
      {
        name: "description",
        content:
          "Create and revoke workspace API keys that let autonomous agents call metered tools.",
      },
      { property: "og:title", content: "API keys — Relay Agent Tool API" },
      { property: "og:description", content: "Manage machine credentials for agent tool access." },
    ],
  }),
  component: KeysPage,
});

function KeysPage() {
  return (
    <ConsoleShell
      title="API keys"
      description="Machine credentials. An agent presents a key as a bearer token to call any tool in the catalog."
    >
      {(org) => <KeysPanel orgId={org.id} />}
    </ConsoleShell>
  );
}

function KeysPanel({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const list = useServerFn(listAgentKeys);
  const create = useServerFn(createAgentKey);
  const revoke = useServerFn(revokeAgentKey);
  const [label, setLabel] = useState("");
  const [freshKey, setFreshKey] = useState<string | null>(null);

  const keys = useQuery({
    queryKey: ["agent-keys", orgId],
    queryFn: () => list({ data: { orgId } }),
  });

  const createMutation = useMutation({
    mutationFn: () => create({ data: { orgId, label: label.trim() || "Agent key" } }),
    onSuccess: (row) => {
      setFreshKey(row.key);
      setLabel("");
      queryClient.invalidateQueries({ queryKey: ["agent-keys", orgId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create key"),
  });

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => revoke({ data: { keyId } }),
    onSuccess: () => {
      toast.success("Key revoked");
      queryClient.invalidateQueries({ queryKey: ["agent-keys", orgId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not revoke key"),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create a key</CardTitle>
          <CardDescription>
            The secret is shown once. Store it in your agent's environment — it is never
            recoverable.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label, e.g. production-orchestrator"
            maxLength={80}
          />
          <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
            {createMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <KeyRound className="size-4" />
            )}
            Create key
          </Button>
        </CardContent>
      </Card>

      {freshKey && (
        <Card className="border-primary/40 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-base">Copy your new key now</CardTitle>
            <CardDescription>This is the only time it will be displayed.</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-3">
            <code className="flex-1 overflow-x-auto rounded-md bg-background px-3 py-2 font-mono text-xs">
              {freshKey}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(freshKey);
                toast.success("Copied");
              }}
            >
              <Copy className="size-3.5" /> Copy
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your keys</CardTitle>
        </CardHeader>
        <CardContent>
          {keys.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Loading
            </p>
          ) : keys.error ? (
            <p className="text-sm text-destructive">
              {keys.error instanceof Error ? keys.error.message : "Could not load keys"}
            </p>
          ) : !keys.data?.length ? (
            <p className="text-sm text-muted-foreground">No keys yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {keys.data.map((k) => (
                <li key={k.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{k.label}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        sk_agent_{k.key_prefix}_••••
                        {k.last_used_at
                          ? ` · last used ${new Date(k.last_used_at).toLocaleString()}`
                          : " · never used"}
                      </p>
                    </div>
                    {k.revoked_at ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        revoked
                      </span>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={revokeMutation.isPending}
                        onClick={() => revokeMutation.mutate(k.id)}
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                  {!k.revoked_at && <KeyLimitsEditor keyRow={k} orgId={orgId} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

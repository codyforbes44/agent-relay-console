import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Loader2, Plug, Unplug } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";

import { CustomApiKeys } from "@/components/workspace/CustomApiKeys";
import { ConsoleShell } from "@/components/workspace/ConsoleShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getOAuthAuthorizeUrl,
  listOAuthConnections,
  listOAuthProviders,
  revokeOAuthConnection,
} from "@/lib/api/oauth.functions";

export const Route = createFileRoute("/_authenticated/connections")({
  validateSearch: (search: Record<string, unknown>): { connected?: string; oauth?: string } => {
    const out: { connected?: string; oauth?: string } = {};
    if (typeof search["connected"] === "string") out.connected = search["connected"];
    if (typeof search["oauth"] === "string") out.oauth = search["oauth"];
    return out;
  },
  head: () => ({
    meta: [
      { title: "Connected accounts — Relay Agent Tool API" },
      {
        name: "description",
        content:
          "Link third-party accounts once; every agent in the workspace can use them through managed tools.",
      },
    ],
  }),
  component: ConnectionsPage,
});

function ConnectionsPage() {
  const search = Route.useSearch();
  useEffect(() => {
    if (search.connected) toast.success(`Connected ${search.connected} — agents can use it now`);
    if (search.oauth === "error") toast.error("The OAuth flow failed — try connecting again");
  }, [search.connected, search.oauth]);

  return (
    <ConsoleShell
      title="Connected accounts"
      description="Link a third-party account once and every agent in this workspace can act through it — Gmail, Slack, GitHub — without ever seeing the credentials. Tokens are encrypted and refresh automatically."
    >
      {(org) => (
        <div className="space-y-6">
          <ConnectionsPanel orgId={org.id} />
          <CustomApiKeys orgId={org.id} />
        </div>
      )}
    </ConsoleShell>
  );
}

function ConnectionsPanel({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const providersFn = useServerFn(listOAuthProviders);
  const connectionsFn = useServerFn(listOAuthConnections);
  const authorizeFn = useServerFn(getOAuthAuthorizeUrl);
  const revokeFn = useServerFn(revokeOAuthConnection);

  const providers = useQuery({
    queryKey: ["oauth-providers"],
    queryFn: () => providersFn(),
  });
  const connections = useQuery({
    queryKey: ["oauth-connections", orgId],
    queryFn: () => connectionsFn({ data: { orgId } }),
  });

  const connectMutation = useMutation({
    mutationFn: (provider: string) => authorizeFn({ data: { orgId, provider } }),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not start OAuth"),
  });

  const revokeMutation = useMutation({
    mutationFn: (connectionId: string) => revokeFn({ data: { orgId, connectionId } }),
    onSuccess: () => {
      toast.success("Connection revoked");
      queryClient.invalidateQueries({ queryKey: ["oauth-connections", orgId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not revoke"),
  });

  const rows = connections.data ?? [];
  const activeByProvider = new Set(
    rows.filter((c) => c.status === "active").map((c) => c.provider),
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {providers.isLoading ? (
          <Card>
            <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading providers
            </CardContent>
          </Card>
        ) : (
          providers.data?.map((p) => (
            <Card key={p.slug}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Plug className="size-4" /> {p.name}
                </CardTitle>
                <CardDescription className="flex flex-wrap gap-1 pt-1">
                  {p.scopes.map((s) => (
                    <Badge key={s} variant="outline" className="font-mono text-[10px]">
                      {s}
                    </Badge>
                  ))}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-2">
                {activeByProvider.has(p.slug) ? (
                  <Badge>connected</Badge>
                ) : (
                  <Badge variant="outline">not connected</Badge>
                )}
                <div className="flex gap-2">
                  {p.docsUrl && (
                    <Button variant="ghost" size="sm" asChild>
                      <a href={p.docsUrl} target="_blank" rel="noreferrer">
                        <ExternalLink className="size-3.5" />
                      </a>
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={() => connectMutation.mutate(p.slug)}
                    disabled={connectMutation.isPending}
                  >
                    {connectMutation.isPending && connectMutation.variables === p.slug ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : null}
                    Connect
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workspace connections</CardTitle>
          <CardDescription>
            Tokens are encrypted at rest and never exposed to agents — tools use them server-side on
            the agent's behalf.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {connections.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading connections
            </div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No accounts connected yet. Connect one above to unlock the managed tools (gmail_send,
              slack_post_message, github_create_issue).
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Scopes</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.providerName}</TableCell>
                    <TableCell>{c.accountLabel}</TableCell>
                    <TableCell className="max-w-xs">
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">
                        {c.scopes.join(" ")}
                      </span>
                    </TableCell>
                    <TableCell>
                      {c.status === "active" ? (
                        <Badge>active</Badge>
                      ) : c.status === "revoked" ? (
                        <Badge variant="outline">revoked</Badge>
                      ) : (
                        <Badge variant="destructive">expired</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.expiresAt ? new Date(c.expiresAt).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {c.status === "active" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => revokeMutation.mutate(c.id)}
                          disabled={revokeMutation.isPending}
                        >
                          <Unplug className="size-3.5" /> Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

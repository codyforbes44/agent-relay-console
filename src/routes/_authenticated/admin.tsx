import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";

import { ConsoleShell } from "@/components/workspace/ConsoleShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getAdminOverview,
  getAdminRoles,
  adminAdjustCredits,
  adminRevokeKey,
  adminSetRole,
} from "@/lib/admin/admin.functions";


export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Super admin — Agent Relay Console" },
      {
        name: "description",
        content:
          "Platform control room: workspaces, users, API keys, credits, revenue and tool usage across Agent Relay Console.",
      },
      { property: "og:title", content: "Super admin — Agent Relay Console" },
      { property: "og:description", content: "Platform-wide administration for Agent Relay Console." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  return (
    <ConsoleShell
      title="Super admin"
      description="Platform-wide control over workspaces, users, keys, credits and usage."
    >
      {() => <AdminPanel />}
    </ConsoleShell>
  );
}

function AdminPanel() {
  const overviewFn = useServerFn(getAdminOverview);
  const rolesFn = useServerFn(getAdminRoles);
  const queryClient = useQueryClient();

  const overview = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => overviewFn(),
    refetchInterval: 30_000,
  });
  const roles = useQuery({ queryKey: ["admin", "roles"], queryFn: () => rolesFn() });

  const [orgQuery, setOrgQuery] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [keyQuery, setKeyQuery] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin"] });


  const adjust = useMutation({
    mutationFn: useServerFn(adminAdjustCredits),
    onSuccess: () => {
      toast.success("Credits adjusted");
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const revoke = useMutation({
    mutationFn: useServerFn(adminRevokeKey),
    onSuccess: () => {
      toast.success("Key revoked");
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const setRole = useMutation({
    mutationFn: useServerFn(adminSetRole),
    onSuccess: () => {
      toast.success("Role updated");
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (overview.isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Loading platform data
      </p>
    );
  }
  if (overview.error || !overview.data) {
    const message = overview.error instanceof Error ? overview.error.message : "Unavailable";
    return (
      <p className="text-sm text-destructive">
        {message === "Forbidden" ? "You do not have super admin access." : message}
      </p>
    );
  }

  const d = overview.data;
  const superAdmins = new Set(
    (roles.data ?? []).filter((r) => r.role === "super_admin").map((r) => r.user_id),
  );
  const orgName = new Map(d.orgs.map((o) => [o.id, o.name] as const));

  const oq = orgQuery.trim().toLowerCase();
  const uq = userQuery.trim().toLowerCase();
  const kq = keyQuery.trim().toLowerCase();
  const filteredOrgs = oq
    ? d.orgs.filter((o) => `${o.name} ${o.slug}`.toLowerCase().includes(oq))
    : d.orgs;
  const filteredUsers = uq
    ? d.users.filter((u) => `${u.display_name ?? ""} ${u.email ?? ""}`.toLowerCase().includes(uq))
    : d.users;
  const filteredKeys = kq
    ? d.keys.filter((k) =>
        `${k.label} ${k.key_prefix} ${orgName.get(k.org_id) ?? ""}`.toLowerCase().includes(kq),
      )
    : d.keys;
  const filteredUsage = errorsOnly ? d.usage.filter((e) => e.status !== "success") : d.usage;


  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Workspaces" value={d.totals.orgs.toLocaleString()} />
        <Stat label="Users" value={d.totals.users.toLocaleString()} />
        <Stat label="Active API keys" value={d.totals.activeKeys.toLocaleString()} />
        <Stat label="Credits outstanding" value={d.totals.creditsOutstanding.toLocaleString()} />
        <Stat label="Recent calls" value={d.totals.callsRecent.toLocaleString()} />
        <Stat label="Recent errors" value={d.totals.errorsRecent.toLocaleString()} />
        <Stat
          label="Purchase revenue"
          value={`$${(d.totals.revenueCents / 100).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`}
        />
      </div>

      <Tabs defaultValue="orgs">
        <TabsList>
          <TabsTrigger value="orgs">Workspaces</TabsTrigger>
          <TabsTrigger value="users">Users &amp; roles</TabsTrigger>
          <TabsTrigger value="keys">API keys</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="revenue">Revenue</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
        </TabsList>

        <TabsContent value="orgs" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Workspaces</CardTitle>
              <CardDescription>Balances, key counts and manual credit adjustments.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                value={orgQuery}
                onChange={(e) => setOrgQuery(e.target.value)}
                placeholder="Search workspaces by name or slug"
                aria-label="Search workspaces"
              />
              {filteredOrgs.slice(0, 50).map((o) => (
                <OrgRow
                  key={o.id}
                  org={o}
                  pending={adjust.isPending}
                  onAdjust={(delta, reason) => adjust.mutate({ data: { orgId: o.id, delta, reason } })}
                />
              ))}
              {!filteredOrgs.length && (
                <p className="text-sm text-muted-foreground">No workspaces match.</p>
              )}
              {filteredOrgs.length > 50 && (
                <p className="text-xs text-muted-foreground">
                  Showing 50 of {filteredOrgs.length}. Narrow the search to see more.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Users</CardTitle>
              <CardDescription>Grant or remove the platform super admin role.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                placeholder="Search users by name or email"
                aria-label="Search users"
              />
              <ul className="divide-y divide-border">
                {filteredUsers.slice(0, 100).map((u) => {
                  const isSuper = superAdmins.has(u.id);
                  return (
                    <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {u.display_name ?? "Member"}
                        </p>
                        <p className="font-mono text-xs text-muted-foreground">{u.email}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {isSuper && (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                            super admin
                          </span>
                        )}
                        <Confirm
                          title={isSuper ? "Revoke super admin?" : "Grant super admin?"}
                          description={
                            isSuper
                              ? `${u.email} will lose platform-wide access immediately.`
                              : `${u.email} will gain full platform-wide access to every workspace, key and credit balance.`
                          }
                          confirmLabel={isSuper ? "Revoke role" : "Grant role"}
                          onConfirm={() =>
                            setRole.mutate({
                              data: { userId: u.id, role: "super_admin", grant: !isSuper },
                            })
                          }
                          trigger={
                            <Button size="sm" variant={isSuper ? "outline" : "default"} disabled={setRole.isPending}>
                              {isSuper ? (
                                <>
                                  <ShieldOff className="size-3.5" /> Revoke
                                </>
                              ) : (
                                <>
                                  <ShieldCheck className="size-3.5" /> Make super admin
                                </>
                              )}
                            </Button>
                          }
                        />
                      </div>
                    </li>
                  );
                })}
                {!filteredUsers.length && (
                  <p className="text-sm text-muted-foreground">No users match.</p>
                )}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="keys" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">API keys</CardTitle>
              <CardDescription>Every agent key issued across the platform.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                value={keyQuery}
                onChange={(e) => setKeyQuery(e.target.value)}
                placeholder="Search keys by label, prefix or workspace"
                aria-label="Search API keys"
              />
              <ul className="divide-y divide-border">
                {filteredKeys.slice(0, 100).map((k) => (
                  <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="text-sm text-foreground">
                        {k.label}{" "}
                        <span className="text-xs text-muted-foreground">
                          · {orgName.get(k.org_id) ?? "unknown workspace"}
                        </span>
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {k.key_prefix}··· · {k.revoked_at ? "revoked" : "active"} ·{" "}
                        {k.last_used_at ? `used ${new Date(k.last_used_at).toLocaleString()}` : "never used"}
                      </p>
                    </div>
                    {!k.revoked_at && (
                      <Confirm
                        title="Revoke this API key?"
                        description={`${k.label} (${k.key_prefix}···) in ${orgName.get(k.org_id) ?? "this workspace"} will stop working immediately. This cannot be undone.`}
                        confirmLabel="Revoke key"
                        destructive
                        onConfirm={() => revoke.mutate({ data: { keyId: k.id } })}
                        trigger={
                          <Button size="sm" variant="outline" disabled={revoke.isPending}>
                            Revoke
                          </Button>
                        }
                      />
                    )}
                  </li>
                ))}
                {!filteredKeys.length && (
                  <p className="text-sm text-muted-foreground">No keys match.</p>
                )}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="usage" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent tool calls</CardTitle>
              <CardDescription>Last 200 metered events platform-wide.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-3">
                <Button
                  size="sm"
                  variant={errorsOnly ? "default" : "outline"}
                  onClick={() => setErrorsOnly((v) => !v)}
                >
                  {errorsOnly ? "Showing failures only" : "Show failures only"}
                </Button>
              </div>
              <ul className="divide-y divide-border">
                {filteredUsage.map((e) => (

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
                            : "rounded-full bg-destructive/10 px-2 py-0.5 text-destructive"
                        }
                      >
                        {e.status}
                      </span>
                      <span className="font-mono text-muted-foreground">-{e.credits}</span>
                    </div>
                  </li>
                ))}
                {!filteredUsage.length && (
                  <p className="text-sm text-muted-foreground">No calls to show.</p>
                )}

              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="revenue" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Credit purchases</CardTitle>
              <CardDescription>Latest 50 completed checkouts.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border">
                {d.purchases.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div>
                      <p className="text-sm text-foreground">
                        {p.credits.toLocaleString()} credits · {p.environment}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(p.created_at).toLocaleString()}
                      </p>
                    </div>
                    <span className="font-mono text-sm text-foreground">
                      {p.amount_cents != null
                        ? `${(p.amount_cents / 100).toFixed(2)} ${p.currency ?? "USD"}`
                        : "—"}
                    </span>
                  </li>
                ))}
                {!d.purchases.length && (
                  <p className="text-sm text-muted-foreground">No purchases yet.</p>
                )}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Audit log</CardTitle>
              <CardDescription>Last 100 recorded platform actions.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border">
                {d.audit.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div>
                      <p className="font-mono text-sm text-foreground">{a.action}</p>
                      <p className="text-xs text-muted-foreground">
                        {orgName.get(a.org_id) ?? a.org_id}
                        {a.tool_name ? ` · ${a.tool_name}` : ""}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(a.created_at).toLocaleString()}
                    </span>
                  </li>
                ))}
                {!d.audit.length && (
                  <p className="text-sm text-muted-foreground">No audit entries yet.</p>
                )}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Confirm({
  title,
  description,
  confirmLabel,
  destructive,
  onConfirm,
  trigger,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  trigger: ReactNode;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function OrgRow({

  org,
  pending,
  onAdjust,
}: {
  org: { id: string; name: string; slug: string; balance: number; recentSpend: number; keyCount: number };
  pending: boolean;
  onAdjust: (delta: number, reason: string) => void;
}) {
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-foreground">{org.name}</p>
          <p className="font-mono text-xs text-muted-foreground">{org.slug}</p>
        </div>
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span>
            balance <span className="font-mono text-foreground">{org.balance.toLocaleString()}</span>
          </span>
          <span>
            recent spend <span className="font-mono text-foreground">{org.recentSpend}</span>
          </span>
          <span>
            keys <span className="font-mono text-foreground">{org.keyCount}</span>
          </span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          className="w-28"
          placeholder="+500"
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
        />
        <Input
          className="max-w-xs flex-1"
          placeholder="Reason (e.g. goodwill credit)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Confirm
          title="Adjust credit balance?"
          description={`This writes ${delta || "0"} credits to ${org.name} and is recorded in the ledger.`}
          confirmLabel="Apply adjustment"
          onConfirm={() => {
            const n = Number(delta);
            if (!Number.isInteger(n) || n === 0) {
              toast.error("Enter a non-zero whole number");
              return;
            }
            if (!reason.trim()) {
              toast.error("Add a reason");
              return;
            }
            onAdjust(n, reason.trim());
            setDelta("");
            setReason("");
          }}
          trigger={
            <Button size="sm" variant="outline" disabled={pending}>

          Adjust credits
        </Button>
      </div>
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

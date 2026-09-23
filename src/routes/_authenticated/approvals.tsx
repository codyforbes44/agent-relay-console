import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ConsoleShell } from "@/components/workspace/ConsoleShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  approveIntent,
  denyIntent,
  fetchApprovalPolicy,
  listApprovalIntents,
  saveApprovalPolicy,
} from "@/lib/api/approvals.functions";
import type { ApprovalIntentView, ApprovalStatus } from "@/lib/api/approvals.server";

export const Route = createFileRoute("/_authenticated/approvals")({
  validateSearch: (search: Record<string, unknown>): { intent?: string } => {
    const intent = search["intent"];
    return typeof intent === "string" ? { intent } : {};
  },
  head: () => ({
    meta: [
      { title: "Approvals — Relay Agent Tool API" },
      {
        name: "description",
        content:
          "Review and decide your agents' side-effecting tool calls, and set auto-approval policy.",
      },
    ],
  }),
  component: ApprovalsPage,
});

function ApprovalsPage() {
  const { intent } = Route.useSearch();
  return (
    <ConsoleShell
      title="Approvals"
      description="Side-effecting tool calls your agents made. Approve or deny them here — approved calls hand the agent a single-use token bound to the exact previewed arguments."
    >
      {(org) => <ApprovalsPanel orgId={org.id} highlightIntent={intent} />}
    </ConsoleShell>
  );
}

type StatusFilter = "pending" | "approved" | "denied" | "all";

function ageOf(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.floor(ms / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function statusBadge(status: ApprovalStatus) {
  switch (status) {
    case "pending":
      return <Badge variant="secondary">pending</Badge>;
    case "approved":
      return <Badge>approved</Badge>;
    case "denied":
      return <Badge variant="destructive">denied</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function ApprovalsPanel({
  orgId,
  highlightIntent,
}: {
  orgId: string;
  highlightIntent?: string | undefined;
}) {
  const queryClient = useQueryClient();
  const list = useServerFn(listApprovalIntents);
  const approve = useServerFn(approveIntent);
  const deny = useServerFn(denyIntent);
  const [status, setStatus] = useState<StatusFilter>("pending");

  const intents = useQuery({
    queryKey: ["approval-intents", orgId, status],
    queryFn: () => list({ data: { orgId, status } }),
    refetchInterval: status === "pending" ? 10_000 : false,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["approval-intents", orgId] });
  };

  const approveMutation = useMutation({
    mutationFn: (intentId: string) => approve({ data: { orgId, intentId } }),
    onSuccess: () => {
      toast.success("Approved — the agent can now complete the call");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not approve"),
  });

  const denyMutation = useMutation({
    mutationFn: ({ intentId, reason }: { intentId: string; reason?: string }) =>
      deny({ data: { orgId, intentId, ...(reason ? { reason } : {}) } }),
    onSuccess: () => {
      toast.success("Denied");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not deny"),
  });

  const onDeny = (intent: ApprovalIntentView) => {
    const reason = window.prompt(`Deny ${intent.toolLabel}? Optionally tell the agent why:`, "");
    if (reason === null) return;
    denyMutation.mutate({
      intentId: intent.id,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    });
  };

  const rows = intents.data ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Inbox</CardTitle>
              <CardDescription>
                Every gated call mints a request here. The agent polls or waits for a webhook and
                retries once you decide.
              </CardDescription>
            </div>
            <Tabs value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
              <TabsList>
                <TabsTrigger value="pending">Pending</TabsTrigger>
                <TabsTrigger value="approved">Approved</TabsTrigger>
                <TabsTrigger value="denied">Denied</TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        <CardContent>
          {intents.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading requests
            </div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {status === "pending"
                ? "Nothing waiting — your agents' side-effecting calls will appear here."
                : `No ${status} requests.`}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tool</TableHead>
                  <TableHead>Preview</TableHead>
                  <TableHead className="text-right">Credits</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((intent) => (
                  <TableRow
                    key={intent.id}
                    className={cn(highlightIntent === intent.id && "bg-primary/5")}
                  >
                    <TableCell className="font-medium">{intent.toolLabel}</TableCell>
                    <TableCell className="max-w-xs">
                      <p className="truncate text-sm">{intent.preview.summary}</p>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                        {intent.policyDecision === "auto"
                          ? "auto-approved by policy"
                          : "human review"}
                        {intent.decidedBy ? ` · by ${intent.decidedBy}` : ""}
                        {intent.reason ? ` · “${intent.reason}”` : ""}
                      </p>
                    </TableCell>
                    <TableCell className="text-right">{intent.credits}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {ageOf(intent.createdAt)}
                    </TableCell>
                    <TableCell>{statusBadge(intent.status)}</TableCell>
                    <TableCell className="text-right">
                      {intent.status === "pending" ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            onClick={() => approveMutation.mutate(intent.id)}
                            disabled={approveMutation.isPending || denyMutation.isPending}
                          >
                            <Check className="size-3.5" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onDeny(intent)}
                            disabled={approveMutation.isPending || denyMutation.isPending}
                          >
                            <X className="size-3.5" /> Deny
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {intent.decidedAt ? ageOf(intent.decidedAt) : "—"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <PolicyEditor orgId={orgId} />
    </div>
  );
}

function parseToolList(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 100);
}

function PolicyEditor({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const fetch = useServerFn(fetchApprovalPolicy);
  const save = useServerFn(saveApprovalPolicy);

  const policy = useQuery({
    queryKey: ["approval-policy", orgId],
    queryFn: () => fetch({ data: { orgId } }),
  });

  const [maxCredits, setMaxCredits] = useState("0");
  const [defaultAction, setDefaultAction] = useState<"human" | "auto">("human");
  const [autoTools, setAutoTools] = useState("");
  const [humanTools, setHumanTools] = useState("");
  const [notifyEmail, setNotifyEmail] = useState("");
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (policy.data && !seeded) {
      setMaxCredits(String(policy.data.autoApproveMaxCredits));
      setDefaultAction(policy.data.defaultAction);
      setAutoTools(policy.data.autoApproveTools.join(", "));
      setHumanTools(policy.data.requireHumanTools.join(", "));
      setNotifyEmail(policy.data.notifyEmail ?? "");
      setSeeded(true);
    }
  }, [policy.data, seeded]);

  const saveMutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          orgId,
          autoApproveMaxCredits: Math.max(0, Math.floor(Number(maxCredits) || 0)),
          autoApproveTools: parseToolList(autoTools),
          requireHumanTools: parseToolList(humanTools),
          defaultAction,
          notifyEmail: notifyEmail.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success("Approval policy saved");
      queryClient.invalidateQueries({ queryKey: ["approval-policy", orgId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save policy"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="size-4" /> Auto-approval policy
        </CardTitle>
        <CardDescription>
          Explicit human-required tools always win, then the auto-approve allowlist, then the credit
          ceiling under an “auto” default. Everything else waits for a human. Only owners and admins
          can change this.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {policy.isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading policy
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ap-default">Default action</Label>
                <Select
                  value={defaultAction}
                  onValueChange={(v) => setDefaultAction(v as "human" | "auto")}
                >
                  <SelectTrigger id="ap-default">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="human">Human review</SelectItem>
                    <SelectItem value="auto">Auto-approve under ceiling</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ap-credits">Auto-approve credit ceiling</Label>
                <Input
                  id="ap-credits"
                  type="number"
                  min={0}
                  value={maxCredits}
                  onChange={(e) => setMaxCredits(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ap-auto">Always auto-approve these tools (comma-separated)</Label>
              <Textarea
                id="ap-auto"
                value={autoTools}
                onChange={(e) => setAutoTools(e.target.value)}
                placeholder="sandbox_send_email, search_web"
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ap-human">
                Always require a human for these tools (comma-separated)
              </Label>
              <Textarea
                id="ap-human"
                value={humanTools}
                onChange={(e) => setHumanTools(e.target.value)}
                placeholder="execute_code"
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ap-email">Notify email (optional)</Label>
              <Input
                id="ap-email"
                type="email"
                value={notifyEmail}
                onChange={(e) => setNotifyEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </div>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              Save policy
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

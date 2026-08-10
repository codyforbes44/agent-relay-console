import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Info } from "lucide-react";
import { toast } from "sonner";

import { ConsoleShell } from "@/components/workspace/ConsoleShell";
import {
  getWorkspaceSettings,
  updateWorkspaceSettings,
  type OrgSettingsInput,
} from "@/lib/api/settings.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
  head: () => ({
    meta: [
      { title: "Workspace settings — RELAY" },
      {
        name: "description",
        content:
          "Configure MCP base URL patterns, tool-confirmation defaults, and job retention for your workspace.",
      },
    ],
  }),
});

const CONFIRMATION_OPTIONS = [
  {
    value: "side_effecting",
    label: "Side-effecting tools only (recommended)",
    hint: "Email, CRM writes, payments, and deletes require an explicit confirmation header.",
  },
  {
    value: "all",
    label: "Every tool",
    hint: "Even read-only lookups require confirmation. Safest, noisiest.",
  },
  {
    value: "none",
    label: "Trusted — no confirmation",
    hint: "Agents can run any enabled tool without confirming. Use only with narrow key allowlists and spend caps.",
  },
] as const;

function SettingsPage() {
  const queryClient = useQueryClient();
  const load = useServerFn(getWorkspaceSettings);
  const save = useServerFn(updateWorkspaceSettings);

  const { data, isLoading, error } = useQuery({
    queryKey: ["workspace-settings"],
    queryFn: () => load(),
  });

  const [form, setForm] = useState<OrgSettingsInput | null>(null);

  useEffect(() => {
    if (!data) return;
    setForm({
      mcpBaseUrl: data.mcpBaseUrl,
      mcpPathPattern: data.mcpPathPattern,
      confirmationDefault: data.confirmationDefault,
      jobRetentionDays: data.jobRetentionDays,
      messageRetentionDays: data.messageRetentionDays,
      defaultModel: data.defaultModel,
      costQualityTier: data.costQualityTier,
    });
  }, [data]);

  const mutation = useMutation({
    mutationFn: (vars: OrgSettingsInput) => save({ data: vars }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace-settings"] });
      toast.success("Workspace settings saved");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save settings"),
  });

  const preview =
    form && data
      ? `${form.mcpBaseUrl.replace(/\/+$/, "")}${form.mcpPathPattern.replace(/\{org_id\}/g, data.orgId)}`
      : "";

  return (
    <ConsoleShell
      title="Workspace settings"
      description="Connection endpoints, confirmation policy, and data retention for this workspace."
    >
      {() => (
        <div className="space-y-6">
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading settings…
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive">
              {error instanceof Error ? error.message : "Could not load settings."}
            </p>
          )}

          {form && data && (
            <form
              className="space-y-6"
              onSubmit={(e) => {
                e.preventDefault();
                mutation.mutate(form);
              }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-medium">MCP endpoint</CardTitle>
                  <CardDescription>
                    Controls the connection URL shown to agents on the Connect page. Use{" "}
                    <code className="font-mono">{"{org_id}"}</code> to inject this workspace id.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-2">
                    <Label htmlFor="mcpBaseUrl">Base URL</Label>
                    <Input
                      id="mcpBaseUrl"
                      value={form.mcpBaseUrl}
                      onChange={(e) => setForm({ ...form, mcpBaseUrl: e.target.value })}
                      placeholder="https://3bi.ai"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="mcpPathPattern">Path pattern</Label>
                    <Input
                      id="mcpPathPattern"
                      className="font-mono"
                      value={form.mcpPathPattern}
                      onChange={(e) => setForm({ ...form, mcpPathPattern: e.target.value })}
                      placeholder="/mcp?tenant={org_id}"
                    />
                  </div>
                  <div className="rounded-md border border-border bg-muted/40 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Preview</p>
                    <p className="mt-1 break-all font-mono text-sm text-foreground">{preview}</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-medium">Tool-confirmation default</CardTitle>
                  <CardDescription>
                    Applies to every API key and MCP connection in this workspace unless a key
                    narrows it further.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Select
                    value={form.confirmationDefault}
                    onValueChange={(v) =>
                      setForm({ ...form, confirmationDefault: v as OrgSettingsInput["confirmationDefault"] })
                    }
                  >
                    <SelectTrigger className="max-w-md">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONFIRMATION_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-sm text-muted-foreground">
                    {CONFIRMATION_OPTIONS.find((o) => o.value === form.confirmationDefault)?.hint}
                  </p>
                  {form.confirmationDefault === "none" && (
                    <Alert variant="destructive">
                      <AlertTitle className="text-sm">No confirmation gate</AlertTitle>
                      <AlertDescription className="text-sm">
                        Agents will be able to send email, write to CRM, create payments, and delete
                        records without a per-call confirmation.
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-medium">Model routing</CardTitle>
                  <CardDescription>
                    Default model and cost/quality tier for the workspace chat agent. "Auto" lets the
                    tier pick the model.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="defaultModel">Default model</Label>
                    <Select
                      value={form.defaultModel}
                      onValueChange={(v) => setForm({ ...form, defaultModel: v })}
                    >
                      <SelectTrigger id="defaultModel">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto (use cost/quality tier)</SelectItem>
                        <SelectItem value="google/gemini-3.1-flash-lite">
                          Gemini 3.1 Flash Lite (fastest, cheapest)
                        </SelectItem>
                        <SelectItem value="google/gemini-3.5-flash">
                          Gemini 3.5 Flash (balanced)
                        </SelectItem>
                        <SelectItem value="google/gemini-3.1-pro-preview">
                          Gemini 3.1 Pro Preview (highest quality)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="costQualityTier">Cost/quality tier</Label>
                    <Select
                      value={form.costQualityTier}
                      onValueChange={(v) =>
                        setForm({ ...form, costQualityTier: v as OrgSettingsInput["costQualityTier"] })
                      }
                    >
                      <SelectTrigger id="costQualityTier">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="economy">Economy</SelectItem>
                        <SelectItem value="balanced">Balanced</SelectItem>
                        <SelectItem value="quality">Quality</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-medium">Retention</CardTitle>
                  <CardDescription>
                    How long this workspace keeps agent jobs and conversation history.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="jobRetentionDays">Job retention (days)</Label>
                    <Input
                      id="jobRetentionDays"
                      type="number"
                      min={1}
                      max={3650}
                      value={form.jobRetentionDays}
                      onChange={(e) =>
                        setForm({ ...form, jobRetentionDays: Number(e.target.value) || 1 })
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="messageRetentionDays">Conversation retention (days)</Label>
                    <Input
                      id="messageRetentionDays"
                      type="number"
                      min={1}
                      max={3650}
                      value={form.messageRetentionDays}
                      onChange={(e) =>
                        setForm({ ...form, messageRetentionDays: Number(e.target.value) || 1 })
                      }
                    />
                  </div>
                  <Alert className="sm:col-span-2 border-primary/20 bg-primary/5">
                    <Info className="size-4 text-primary" />
                    <AlertDescription className="text-sm text-muted-foreground">
                      Usage events, credit ledger entries, and audit logs are retained for billing
                      and compliance regardless of these values.
                    </AlertDescription>
                  </Alert>
                </CardContent>
              </Card>

              <div className="flex items-center gap-3">
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Save settings
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={mutation.isPending}
                  onClick={() =>
                    setForm({
                      mcpBaseUrl: data.mcpBaseUrl,
                      mcpPathPattern: data.mcpPathPattern,
                      confirmationDefault: data.confirmationDefault,
                      jobRetentionDays: data.jobRetentionDays,
                      messageRetentionDays: data.messageRetentionDays,
                      defaultModel: data.defaultModel,
                      costQualityTier: data.costQualityTier,
                    })
                  }
                >
                  Reset
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </ConsoleShell>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, AlertTriangle, Info } from "lucide-react";
import { toast } from "sonner";

import { ConsoleShell } from "@/components/workspace/ConsoleShell";
import { getOrgToolSettings, updateOrgToolSetting } from "@/lib/api/org-tools.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/tools")({
  component: ToolsPage,
  head: () => ({
    meta: [
      { title: "Tool catalog — RELAY" },
      { name: "description", content: "Manage which tools agents can invoke in your workspace." },
    ],
  }),
});

function ToolsPage() {
  const queryClient = useQueryClient();
  const getSettings = useServerFn(getOrgToolSettings);
  const update = useServerFn(updateOrgToolSetting);

  const { data, isLoading, error } = useQuery({
    queryKey: ["org-tools"],
    queryFn: () => getSettings(),
  });

  const mutation = useMutation({
    mutationFn: (vars: { toolName: string; enabled: boolean }) => update({ data: vars }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-tools"] });
      toast.success("Tool visibility updated");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Update failed"),
  });

  return (
    <ConsoleShell
      title="Tool catalog"
      description="Choose which tools agents can invoke in this workspace."
    >
      {() => (
        <div className="space-y-6">
          <Alert variant="default" className="border-primary/20 bg-primary/5">
            <Info className="size-4 text-primary" />
            <AlertTitle className="text-sm font-medium">Workspace-level controls</AlertTitle>
            <AlertDescription className="text-sm text-muted-foreground">
              Disabling a tool here blocks it for every API key and MCP connection in this
              workspace, even when an agent has the budget and confirmation to run it. Existing
              allowlists on individual keys still apply.
            </AlertDescription>
          </Alert>

          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading tool catalog…
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive">
              {error instanceof Error ? error.message : "Could not load tool settings."}
            </p>
          )}

          {data?.tools.map((tool) => (
            <Card
              key={tool.name}
              className={cn("transition-opacity", !tool.enabled && "opacity-60")}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <CardTitle className="text-base font-medium">{tool.label}</CardTitle>
                    <CardDescription className="text-sm">{tool.description}</CardDescription>
                  </div>
                  <div className="flex items-center gap-3">
                    {tool.sideEffecting && (
                      <Badge variant="destructive" className="text-xs">
                        <AlertTriangle className="mr-1 size-3" />
                        Side-effecting
                      </Badge>
                    )}
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`tool-${tool.name}`}
                        checked={tool.enabled}
                        disabled={mutation.isPending}
                        onCheckedChange={(checked) =>
                          mutation.mutate({ toolName: tool.name, enabled: checked })
                        }
                      />
                      <Label htmlFor={`tool-${tool.name}`} className="sr-only">
                        Enable {tool.label}
                      </Label>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="font-mono">{tool.name}</span>
                  <span>•</span>
                  <span>{tool.credits} credits per call</span>
                  <span>•</span>
                  <span className={cn(tool.enabled ? "text-emerald-600" : "text-muted-foreground")}>
                    {tool.enabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </ConsoleShell>
  );
}

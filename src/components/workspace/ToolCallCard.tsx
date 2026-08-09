import {
  CreditCard,
  Database,
  Globe,
  List,
  Mail,
  Search,
  Trash2,
  User,
  Wrench,
} from "lucide-react";
import type { ComponentType } from "react";

import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";
import { TOOLS_BY_NAME, type ToolCallView } from "@/lib/agent/contracts";

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  search: Search,
  user: User,
  list: List,
  mail: Mail,
  database: Database,
  "credit-card": CreditCard,
  trash: Trash2,
  globe: Globe,
};

const STATE_BY_STATUS = {
  pending: "input-streaming",
  awaiting_confirmation: "approval-requested",
  approved: "input-available",
  denied: "output-denied",
  success: "output-available",
  error: "output-error",
} as const;

export function ToolCallCard({
  call,
  onDecision,
  busy,
}: {
  call: ToolCallView;
  onDecision?: (approved: boolean) => void;
  busy?: boolean;
}) {
  const contract = TOOLS_BY_NAME[call.toolName];
  const Icon = ICONS[contract?.icon ?? "search"] ?? Wrench;
  const title = contract?.label ?? call.toolName;
  const summary = contract ? contract.summarize(call.args) : "";

  return (
    <Tool defaultOpen={false} className="mb-3 bg-card/60">
      <ToolHeader
        type="dynamic-tool"
        toolName={call.toolName}
        state={STATE_BY_STATUS[call.status]}
        title={summary ? `${title} · ${summary}` : title}
      />
      <ToolContent>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="size-3.5" />
          <span className="font-mono">{call.toolName}</span>
          {call.sideEffecting && (
            <span className="rounded-full bg-warning/15 px-2 py-0.5 font-medium text-warning">
              side-effecting
            </span>
          )}
        </div>
        <ToolInput input={call.args} />
        <ToolOutput output={call.result ?? null} errorText={call.error ?? undefined} />
      </ToolContent>

      {call.status === "awaiting_confirmation" && onDecision && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-warning/5 px-4 py-3">
          <p className="text-sm text-foreground">
            Approval required before this action runs.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => onDecision(false)}>
              Deny
            </Button>
            <Button size="sm" disabled={busy} onClick={() => onDecision(true)}>
              Approve &amp; run
            </Button>
          </div>
        </div>
      )}
    </Tool>
  );
}

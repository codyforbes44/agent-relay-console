import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PUBLIC_TOOLS } from "@/lib/agent/contracts";
import { updateKeyLimits } from "@/lib/api/keys.functions";

export type KeyLimitsRow = {
  id: string;
  max_credits_per_call: number | null;
  daily_credit_cap: number | null;
  total_credit_cap: number | null;
  expires_at: string | null;
  allowed_tools: string[] | null;
};

const num = (v: string) => {
  const n = Number(v);
  return v.trim() === "" || !Number.isFinite(n) || n <= 0 ? null : Math.floor(n);
};

/**
 * Per-key spend guardrails. These are enforced server-side on every machine
 * call, so a runaway agent cannot spend past what its owner allowed here.
 */
export function KeyLimitsEditor({ keyRow, orgId }: { keyRow: KeyLimitsRow; orgId: string }) {
  const queryClient = useQueryClient();
  const save = useServerFn(updateKeyLimits);

  const [perCall, setPerCall] = useState(keyRow.max_credits_per_call?.toString() ?? "");
  const [daily, setDaily] = useState(keyRow.daily_credit_cap?.toString() ?? "");
  const [total, setTotal] = useState(keyRow.total_credit_cap?.toString() ?? "");
  const [expires, setExpires] = useState(keyRow.expires_at ? keyRow.expires_at.slice(0, 10) : "");
  const [tools, setTools] = useState<string[]>(keyRow.allowed_tools ?? []);

  const mutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          keyId: keyRow.id,
          maxCreditsPerCall: num(perCall),
          dailyCreditCap: num(daily),
          totalCreditCap: num(total),
          expiresAt: expires ? new Date(`${expires}T23:59:59Z`).toISOString() : null,
          allowedTools: tools.length ? tools : null,
        },
      }),
    onSuccess: () => {
      toast.success("Limits saved");
      queryClient.invalidateQueries({ queryKey: ["agent-keys", orgId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save limits"),
  });

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
      <p className="mb-3 flex items-center gap-1.5 text-xs font-medium text-foreground">
        <ShieldCheck className="size-3.5" /> Spend guardrails
      </p>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field
          label="Max credits / call"
          value={perCall}
          onChange={setPerCall}
          placeholder="no limit"
        />
        <Field label="Credits / 24h" value={daily} onChange={setDaily} placeholder="no limit" />
        <Field label="Lifetime credits" value={total} onChange={setTotal} placeholder="no limit" />
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Expires</Label>
          <Input
            type="date"
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
            className="h-8"
          />
        </div>
      </div>

      <div className="mt-3 space-y-1">
        <Label className="text-xs text-muted-foreground">
          Allowed tools {tools.length === 0 && <span>(none selected = all tools)</span>}
        </Label>
        <div className="flex flex-wrap gap-1.5">
          {PUBLIC_TOOLS.map((t) => {
            const on = tools.includes(t.name);
            return (
              <button
                key={t.name}
                type="button"
                onClick={() =>
                  setTools(on ? tools.filter((x) => x !== t.name) : [...tools, t.name])
                }
                className={`rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                  on
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.name}
              </button>
            );
          })}
        </div>
      </div>

      <Button
        size="sm"
        variant="outline"
        className="mt-3"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending && <Loader2 className="size-3.5 animate-spin" />} Save limits
      </Button>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        inputMode="numeric"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-8"
      />
    </div>
  );
}

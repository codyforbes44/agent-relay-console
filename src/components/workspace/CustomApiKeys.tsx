import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, KeyRound, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CREDENTIAL_SERVICES } from "@/lib/api/credential-services";
import {
  deleteCredential,
  listCredentials,
  saveCredential,
  testCredential,
} from "@/lib/api/credentials.functions";

const selectClass =
  "h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground";

export function CustomApiKeys({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listCredentials);
  const saveFn = useServerFn(saveCredential);
  const deleteFn = useServerFn(deleteCredential);
  const testFn = useServerFn(testCredential);

  const [service, setService] = useState("make");
  const [label, setLabel] = useState("Make.com");
  const [secret, setSecret] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({ zone: "us1" });
  const def = CREDENTIAL_SERVICES.find((s) => s.id === service)!;
  const key = ["org-credentials", orgId];

  const list = useQuery({ queryKey: key, queryFn: () => listFn({ data: { orgId } }) });

  const save = useMutation({
    mutationFn: () => saveFn({ data: { orgId, service, label, secret, config } }),
    onSuccess: () => {
      toast.success("Key saved and encrypted");
      setSecret("");
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save key"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { orgId, id } }),
    onSuccess: () => {
      toast.success("Key deleted");
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not delete key"),
  });
  const test = useMutation({
    mutationFn: (id: string) => testFn({ data: { orgId, id } }),
    onSuccess: (r) => {
      if (r.ok) toast.success(`Key works${r.detail ? ` — ${r.detail}` : ""}`);
      else toast.error(r.detail || "Key check failed");
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Key check failed"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4" /> Custom API keys
        </CardTitle>
        <CardDescription>
          Store your own keys for services like Make.com. They are encrypted and never shown
          again. To let Make.com call this app instead, create a key on the{" "}
          <Link to="/keys" className="underline">
            API keys
          </Link>{" "}
          page and paste it into Make's HTTP module as{" "}
          <code className="font-mono text-xs">Authorization: Bearer sk_agent_…</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <select
            className={selectClass}
            value={service}
            onChange={(e) => {
              const next = CREDENTIAL_SERVICES.find((s) => s.id === e.target.value)!;
              setService(next.id);
              setLabel(next.id === "custom" ? "" : next.name);
              setConfig(
                Object.fromEntries(
                  next.configFields.map((f) => [f.key, f.options?.[0]?.value ?? ""]),
                ),
              );
            }}
          >
            {CREDENTIAL_SERVICES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Name, e.g. Production Make"
            maxLength={80}
            required
          />
          {def.configFields.map((f) =>
            f.options ? (
              <select
                key={f.key}
                className={selectClass}
                value={config[f.key] ?? ""}
                onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}
                aria-label={f.label}
              >
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {f.label}: {o.label}
                  </option>
                ))}
              </select>
            ) : null,
          )}
          <Input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Paste API key"
            autoComplete="off"
            required
            minLength={8}
          />
          <p className="text-xs text-muted-foreground sm:col-span-2">
            {def.help}{" "}
            {def.helpUrl && (
              <a href={def.helpUrl} target="_blank" rel="noreferrer" className="underline">
                Docs
              </a>
            )}
          </p>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="size-4 animate-spin" />} Save key
            </Button>
          </div>
        </form>

        {list.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !list.data?.length ? (
          <p className="text-sm text-muted-foreground">No custom keys yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {list.data.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {c.label}{" "}
                    <span className="text-xs text-muted-foreground">
                      · {CREDENTIAL_SERVICES.find((s) => s.id === c.service)?.name ?? c.service}
                      {c.config.zone ? ` · ${c.config.zone}` : ""}
                    </span>
                  </p>
                  <p className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
                    ••••{c.secret_last4}
                    {c.last_verified_at && (
                      <>
                        <CheckCircle2 className="ml-2 size-3 text-primary" /> verified{" "}
                        {new Date(c.last_verified_at).toLocaleDateString()}
                      </>
                    )}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={test.isPending}
                    onClick={() => test.mutate(c.id)}
                  >
                    Test
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(c.id)}
                    aria-label={`Delete ${c.label}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PUBLIC_TOOLS, exampleSuccessEnvelope } from "@/lib/agent/contracts";
import { TOOL_ERRORS } from "@/lib/api/errors";

type Outcome = { status: number; body: string } | null;

/**
 * Docs sandbox: builds a real request for any catalog tool, shows the exact
 * curl, and can send it live (with or without a key) so the caller can see
 * both the success envelope and the real error/status output.
 */
export function TryToolPanel() {
  const [toolName, setToolName] = useState(PUBLIC_TOOLS[0]!.name);
  const tool = useMemo(
    () => PUBLIC_TOOLS.find((t) => t.name === toolName) ?? PUBLIC_TOOLS[0]!,
    [toolName],
  );

  const [apiKey, setApiKey] = useState("");
  const [args, setArgs] = useState(() => JSON.stringify(PUBLIC_TOOLS[0]!.example, null, 2));
  const [useIdempotency, setUseIdempotency] = useState(true);
  const [confirmSideEffects, setConfirmSideEffects] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [busy, setBusy] = useState(false);

  function selectTool(name: string) {
    const next = PUBLIC_TOOLS.find((t) => t.name === name)!;
    setToolName(name);
    setArgs(JSON.stringify(next.example, null, 2));
    setConfirmSideEffects(false);
    setOutcome(null);
  }

  const path = `/api/public/v1/tools/${tool.name}`;
  const idemKey = "run-42";

  const curl = [
    `curl -X POST https://3bi.ai${path} \\`,
    `  -H "Authorization: Bearer ${apiKey.trim() || "$RELAY_KEY"}" \\`,
    `  -H "content-type: application/json" \\`,
    ...(useIdempotency ? [`  -H "idempotency-key: ${idemKey}" \\`] : []),
    ...(confirmSideEffects ? [`  -H "x-confirm-side-effects: true" \\`] : []),
    `  -d '${args.replace(/\s+/g, " ").trim()}'`,
  ].join("\n");

  async function send() {
    setBusy(true);
    setOutcome(null);
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (apiKey.trim()) headers["Authorization"] = `Bearer ${apiKey.trim()}`;
      if (useIdempotency) headers["idempotency-key"] = `${idemKey}-${Date.now()}`;
      if (confirmSideEffects) headers["x-confirm-side-effects"] = "true";
      const res = await fetch(path, { method: "POST", headers, body: args });
      const text = await res.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* non-JSON body: show raw */
      }
      setOutcome({ status: res.status, body: pretty });
    } catch (e) {
      setOutcome({ status: 0, body: e instanceof Error ? e.message : "Network error" });
    } finally {
      setBusy(false);
    }
  }

  const expected = TOOL_ERRORS.filter(
    (e) => tool.sideEffecting || e.code !== "confirmation_required",
  );

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap gap-2">
        {PUBLIC_TOOLS.map((t) => (
          <button
            key={t.name}
            type="button"
            onClick={() => selectTool(t.name)}
            className={`rounded-full border px-3 py-1 font-mono text-xs transition-colors ${
              t.name === tool.name
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.name}
          </button>
        ))}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {tool.description} Costs {tool.credits} credit(s).
        {tool.sideEffecting ? " Side-effecting — needs the confirmation header." : ""}
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="try-key" className="text-xs">
            API key (optional — leave blank to see the 401)
          </Label>
          <Input
            id="try-key"
            type="password"
            autoComplete="off"
            placeholder="sk_agent_…"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="font-mono text-xs"
          />
          <div className="flex items-center justify-between pt-2">
            <Label htmlFor="try-idem" className="text-xs">
              Send idempotency-key
            </Label>
            <Switch id="try-idem" checked={useIdempotency} onCheckedChange={setUseIdempotency} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="try-confirm" className="text-xs">
              Send x-confirm-side-effects
            </Label>
            <Switch
              id="try-confirm"
              checked={confirmSideEffects}
              onCheckedChange={setConfirmSideEffects}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="try-args" className="text-xs">
            Request body
          </Label>
          <Textarea
            id="try-args"
            rows={7}
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            className="font-mono text-xs"
            spellCheck={false}
          />
        </div>
      </div>

      <pre className="mt-4 overflow-x-auto rounded-lg border border-border bg-muted/40 p-4 font-mono text-xs text-foreground">
        {curl}
      </pre>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={send} disabled={busy}>
          {busy ? "Sending…" : "Send request"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Runs against the live API from your browser. Demo tools only touch fixtures.
        </span>
      </div>

      {outcome ? (
        <div className="mt-4">
          <p className="mb-2 font-mono text-xs text-primary">
            HTTP {outcome.status || "network error"}
          </p>
          <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-muted/40 p-4 font-mono text-xs text-foreground">
            {outcome.body}
          </pre>
        </div>
      ) : null}

      <details className="mt-4 rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-xs font-medium text-foreground">
          Expected outputs for {tool.name}
        </summary>
        <p className="mt-3 text-xs text-muted-foreground">200 — success envelope</p>
        <pre className="mt-1 overflow-x-auto rounded border border-border bg-muted/40 p-3 font-mono text-[11px] text-foreground">
          {JSON.stringify(exampleSuccessEnvelope(tool), null, 2)}
        </pre>
        <ul className="mt-3 space-y-1">
          {expected.map((e) => (
            <li key={e.code} className="text-xs text-muted-foreground">
              <span className="font-mono text-primary">
                {e.status} {e.code}
              </span>{" "}
              — {e.cause} {e.action}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

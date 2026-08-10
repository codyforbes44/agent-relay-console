import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { PublicShell } from "@/components/public/PublicShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { publicHead } from "@/lib/site";

async function sha256Hex(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type State =
  | { kind: "loading" }
  | { kind: "signin" }
  | { kind: "done"; orgId: string }
  | { kind: "error"; message: string };

export const Route = createFileRoute("/claim")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): { token?: string } => {
    const token = typeof s["token"] === "string" ? s["token"] : undefined;
    return token ? { token } : {};
  },
  head: () =>
    publicHead({
      path: "/claim",
      title: "Claim your agent workspace — RELAY",
      description:
        "Take ownership of a workspace your agent created on RELAY. Sign in to unlock billing, usage history and key management.",
    }),
  component: ClaimPage,
});

function ClaimPage() {
  const { token } = Route.useSearch();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setState({ kind: "error", message: "This claim link is missing its token." });
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        if (!cancelled) setState({ kind: "signin" });
        return;
      }
      const { data: orgId, error } = await supabase.rpc("claim_organization", {
        _token_hash: await sha256Hex(token),
      });
      if (cancelled) return;
      if (error) setState({ kind: "error", message: error.message });
      else if (!orgId)
        setState({
          kind: "error",
          message: "This claim link is invalid, already used, or expired.",
        });
      else setState({ kind: "done", orgId: String(orgId) });
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const next = `/claim${token ? `?token=${encodeURIComponent(token)}` : ""}`;

  return (
    <PublicShell>
      <main className="mx-auto w-full max-w-xl px-6 py-24">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Claim your agent workspace
        </h1>

        {state.kind === "loading" && (
          <p className="mt-4 text-muted-foreground">Checking your claim link…</p>
        )}

        {state.kind === "signin" && (
          <>
            <p className="mt-4 text-muted-foreground">
              An agent created this workspace and its API key. Sign in to take ownership: you get
              the usage history, key management and the ability to buy credits.
            </p>
            <Button className="mt-6" asChild>
              <Link to="/auth" search={{ next }}>
                Sign in to claim
              </Link>
            </Button>
          </>
        )}

        {state.kind === "done" && (
          <>
            <p className="mt-4 text-muted-foreground">
              Done — this workspace is now yours. Your agent&apos;s existing API key keeps working.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild>
                <Link to="/billing">Add credits</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/keys">Manage keys</Link>
              </Button>
            </div>
          </>
        )}

        {state.kind === "error" && (
          <>
            <p className="mt-4 text-muted-foreground">{state.message}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Ask your agent to request a fresh link with{" "}
              <code className="font-mono">POST /api/public/v1/claim</code>.
            </p>
            <Button className="mt-6" variant="outline" asChild>
              <Link to="/docs">Read the docs</Link>
            </Button>
          </>
        )}
      </main>
    </PublicShell>
  );
}

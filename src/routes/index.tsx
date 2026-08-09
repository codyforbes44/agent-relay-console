import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ShieldCheck, Workflow, Terminal } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Relay — Authenticated AI Agent Workspace" },
      {
        name: "description",
        content:
          "Relay is a tenant-scoped AI agent workspace with streaming answers, typed tool contracts, and explicit approval before any side-effecting action.",
      },
      { property: "og:title", content: "Relay — Authenticated AI Agent Workspace" },
      {
        property: "og:description",
        content:
          "Streaming agent runs, a live tool-call timeline, and human approval gates for email, CRM, payment and delete actions.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
  }, []);

  return (
    <main className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <span className="font-mono text-sm font-semibold tracking-[0.3em] text-primary">RELAY</span>
        <Button
          variant={signedIn ? "default" : "outline"}
          onClick={() => navigate({ to: signedIn ? "/chat" : "/auth" })}
        >
          {signedIn ? "Open workspace" : "Sign in"}
        </Button>
      </header>

      <section className="mx-auto max-w-3xl px-6 pt-16 pb-10 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.35em] text-muted-foreground">
          Agent operations console
        </p>
        <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl">
          An AI agent your team can actually audit.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground">
          Streaming responses, a live tool-call timeline, and a hard stop before anything sends an
          email, edits your CRM, moves money, or deletes a record.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button size="lg" asChild>
            <Link to={signedIn ? "/chat" : "/auth"}>
              {signedIn ? "Open workspace" : "Get started"}
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link to="/docs">Agent API docs</Link>
          </Button>
        </div>

      </section>

      <section className="mx-auto grid max-w-4xl gap-4 px-6 pb-24 sm:grid-cols-3">
        {[
          {
            icon: ShieldCheck,
            title: "Tenant-scoped by default",
            body: "Every conversation, message, job and audit log is isolated per organization at the database level.",
          },
          {
            icon: Workflow,
            title: "Typed tool contracts",
            body: "Each invocation shows its schema-validated arguments and result inline as the run unfolds.",
          },
          {
            icon: Terminal,
            title: "One server entry point",
            body: "The browser only calls POST /api/agent. Model credentials never leave the server.",
          },
        ].map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-lg border border-border bg-card p-5 text-left">
            <Icon className="size-5 text-primary" />
            <h2 className="mt-3 text-sm font-semibold text-card-foreground">{title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}

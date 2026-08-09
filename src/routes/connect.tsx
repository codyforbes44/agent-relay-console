import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { PublicShell } from "@/components/public/PublicShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { SITE_URL, publicHead } from "@/lib/site";

const SERVER_NAME = "relay";


export const Route = createFileRoute("/connect")({
  head: () =>
    publicHead({
      path: "/connect",
      title: "Connect RELAY to your AI assistant",
      description:
        "Step-by-step instructions to connect RELAY to ChatGPT, Claude, Claude Code, or any MCP client, and how to refresh the connection after updates.",
    }),
  component: ConnectPage,
});

function CopyRow({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-4 sm:flex-row sm:items-center">
      <code className="flex-1 overflow-x-auto whitespace-pre font-mono text-sm text-foreground">
        {value}
      </code>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? "Copied" : `Copy ${label}`}
      </Button>
    </div>
  );
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="ml-5 list-decimal space-y-2 text-sm text-muted-foreground">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ol>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-border p-5">
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function ConnectPage() {
  const [origin, setOrigin] = useState(SITE_URL);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [customMcpUrl, setCustomMcpUrl] = useState<string | null>(null);

  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) return;
      const { data } = await supabase
        .from("org_members")
        .select("org_id, organizations(name)")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!active || !data) return;
      setOrgId(data.org_id);
      setOrgName((data.organizations as { name: string } | null)?.name ?? "Workspace");

      const { data: settings } = await supabase
        .from("org_settings")
        .select("mcp_base_url, mcp_path_pattern")
        .eq("org_id", data.org_id)
        .maybeSingle();
      if (!active || !settings) return;
      const base = (settings.mcp_base_url ?? "").replace(/\/+$/, "");
      const path = (settings.mcp_path_pattern ?? "").replace(/\{org_id\}/g, data.org_id);
      if (base && path) setCustomMcpUrl(`${base}${path.startsWith("/") ? "" : "/"}${path}`);
    })();
    return () => {
      active = false;
    };
  }, []);

  const baseMcpUrl = new URL("/mcp", origin).toString();
  const mcpUrl = customMcpUrl ?? (orgId ? `${baseMcpUrl}?tenant=${orgId}` : baseMcpUrl);
  const installCommand = `claude mcp add --scope user --transport http ${SERVER_NAME} '${mcpUrl.replaceAll("'", "'\\''")}'`;
  const claudeLink = `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=${encodeURIComponent("RELAY")}&connectorUrl=${encodeURIComponent(mcpUrl)}`;

  return (
    <PublicShell>
      <main className="mx-auto w-full max-w-3xl space-y-10 px-6 py-14">
        <header className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Connect RELAY to your AI assistant
          </h1>
          <p className="text-muted-foreground">
            RELAY runs a remote MCP server. Add it to your assistant once and it can search the
            knowledge base, look up CRM contacts, list records, and — with your approval — send
            email, update the CRM, create payments, or delete records.
          </p>
        </header>

        <div className="space-y-2">
          <h2 className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            {orgId ? "Your workspace server URL" : "Server URL"}
          </h2>
          <CopyRow value={mcpUrl} label="URL" />
          <p className="text-xs text-muted-foreground">
            {orgId ? (
              <>
                Unique to <span className="text-foreground">{orgName}</span>. Calls still require
                sign-in, and credits are billed to this workspace.
              </>
            ) : (
              <>
                Sign in to get the connection URL tagged with your workspace. The generic URL also
                works — you pick the workspace when you authorize.
              </>
            )}
          </p>
        </div>


        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-foreground">Connect</h2>

          <Section title="ChatGPT">
            <Steps
              items={[
                <>
                  Open{" "}
                  <a
                    className="text-primary underline"
                    href="https://chatgpt.com/#settings/Connectors/Advanced"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Settings → Apps → Advanced
                  </a>{" "}
                  and turn on Developer mode (read the risk notice shown there). If it is not
                  available, ask a ChatGPT admin to enable it.
                </>,
                <>
                  Open the{" "}
                  <a
                    className="text-primary underline"
                    href="https://chatgpt.com/plugins#settings/Connectors?create-connector=true&redirectAfter=%2Fplugins"
                    target="_blank"
                    rel="noreferrer"
                  >
                    New plugin dialog
                  </a>
                  .
                </>,
                <>Enter the name “RELAY” and paste the server URL above.</>,
                <>
                  Review the details, tick “I understand and want to continue” (ChatGPT shows this
                  for every custom server), then click Create.
                </>,
                <>Enable RELAY from the chat composer and ask ChatGPT to use it.</>,
              ]}
            />
          </Section>

          <Section title="Claude">
            <Steps
              items={[
                <>
                  Open the{" "}
                  <a className="text-primary underline" href={claudeLink} target="_blank" rel="noreferrer">
                    prefilled custom connector dialog
                  </a>
                  .
                </>,
                <>Review the name and URL, then click Add.</>,
                <>
                  If the prefilled form does not open, go to Claude’s Connectors page, choose “Add
                  custom connector”, name it RELAY and paste the server URL above.
                </>,
                <>Enable the connector from the chat composer and ask Claude to use it.</>,
              ]}
            />
          </Section>

          <Section title="Claude Code">
            <Steps
              items={[
                <>Run this in a terminal:</>,
                <>
                  Start Claude Code and run <code className="font-mono">/mcp</code> to confirm RELAY
                  is connected, then sign in from that menu when prompted.
                </>,
                <>Ask Claude Code to use RELAY.</>,
              ]}
            />
            <CopyRow value={installCommand} label="command" />
          </Section>

          <Section title="Cursor">
            <Steps
              items={[
                <>
                  Open Cursor → Settings → <span className="text-foreground">MCP &amp; Integrations</span>{" "}
                  → “Add custom MCP”.
                </>,
                <>
                  Add an entry named <code className="font-mono">relay</code> with the server URL
                  above as a streamable HTTP server:
                </>,
                <>Save, then complete the sign-in prompt Cursor opens in your browser.</>,
                <>Toggle RELAY on in the MCP list and ask Cursor’s agent to use it.</>,
              ]}
            />
            <CopyRow
              value={`{
  "mcpServers": {
    "relay": { "url": "${mcpUrl}" }
  }
}`}
              label="config"
            />
          </Section>

          <Section title="Other MCP clients">

            <Steps
              items={[
                <>Open the client’s MCP server or custom connector settings.</>,
                <>Create a remote MCP server connection.</>,
                <>Name it RELAY and paste the server URL above.</>,
                <>Finish any sign-in or authorization prompts.</>,
                <>Enable the connection and ask the assistant to use RELAY.</>,
              ]}
            />
          </Section>
        </div>

        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-foreground">Refresh after RELAY changes</h2>
          <p className="text-sm text-muted-foreground">
            Assistants cache the tool list, so refresh the connection after we ship updates.
          </p>

          <Section title="ChatGPT">
            <Steps
              items={[
                <>Open the Plugins page and select RELAY.</>,
                <>Scroll to “Information” and click Refresh.</>,
                <>
                  ChatGPT cannot change an existing app’s URL — if the URL changed, delete the app
                  and repeat the connect steps.
                </>,
                <>Start a new chat and ask ChatGPT to use RELAY.</>,
              ]}
            />
          </Section>

          <Section title="Claude">
            <Steps
              items={[
                <>Open the Connectors page and select RELAY.</>,
                <>Refresh or update the connector’s tools.</>,
                <>
                  Claude cannot change an existing connector’s URL — if it changed, remove the
                  connector and repeat the connect steps.
                </>,
                <>Ask Claude to use RELAY.</>,
              ]}
            />
          </Section>

          <Section title="Claude Code">
            <Steps
              items={[
                <>Start a new Claude Code session — it loads the latest tools on connect.</>,
                <>
                  If the URL changed, run{" "}
                  <code className="font-mono">claude mcp remove {SERVER_NAME}</code> and run the
                  install command again.
                </>,
                <>Ask Claude Code to use RELAY.</>,
              ]}
            />
          </Section>

          <Section title="Other MCP clients">
            <Steps
              items={[
                <>Open the client’s MCP server or connector settings.</>,
                <>Select the RELAY connection.</>,
                <>Refresh the tool list, reload the server, or reconnect it.</>,
                <>If the URL changed, paste the latest URL from above.</>,
                <>Start a new chat or session and ask the assistant to use RELAY.</>,
              ]}
            />
          </Section>
        </div>
      </main>
    </PublicShell>
  );
}

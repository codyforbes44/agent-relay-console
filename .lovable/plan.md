# MCP review follow-up: catalog reality and security posture

Your review is accurate. /mcp works as described, the 402/428 semantics are clean, and the OAuth 2.1 + MCP wiring is live. Two gaps should be closed before this is a production-grade marketplace surface:

1. The catalog is currently a self-contained demo set.
2. MCP OAuth consent grants access to the whole catalog at once, while the only per-tool enforcement is the key-level allowlist and the per-call 428 confirmation gate.

## What to change

### 1. Make the demo status honest everywhere

All public surfaces currently present the six tools as the live RELAY catalog. Because every tool is `demo: true` and backed by simulated fixtures, the site should label them as a starter/demo set and explain how real integrations will be added.

- Update `src/routes/index.tsx`, `src/routes/docs.tsx`, `src/routes/connect.tsx`, `src/routes/llms.txt.ts` and `src/lib/agent/contracts.ts` to mark demo tools as `demo: true` in the user-facing copy and add a "Starter tools" or "Demo catalog" label.
- Add a short roadmap section on `/docs` and `/connect` stating that real integrations (email provider, CRM, payment processor) are enabled per workspace via settings or API, and that non-demo tools will be added through a provider registration flow.
- Keep the existing tool examples and pricing; only the framing changes.

### 2. Add per-tool visibility and MCP scopes

The key-level allowlist in `agent_keys.allowed_tools` is already enforced, but MCP clients discover every tool at connection time and users approve the whole set in OAuth. Close the gap with workspace-level tool visibility.

- Add `public.org_tools` (or equivalent) table: `org_id`, `tool_name`, `enabled`, `requires_confirmation` (default `true` for side-effecting tools), plus grants/policies.
- Add a migration and RLS policies so only workspace owners/super admins can enable/disable tools for their org.
- Update `src/lib/agent/contracts.ts` and `src/lib/agent/tools.server.ts` to filter the catalog at runtime by `org_tools.enabled` for both the REST catalog and MCP list-tools.
- Default all current tools to enabled for backward compatibility, but allow an owner to disable `create_payment`, `send_email`, `delete_record` or any high-risk tool entirely.
- Update `src/routes/_authenticated/keys.tsx` or add a new `Tools` settings page so owners can toggle tools per workspace and see which are side-effecting.

### 3. Improve MCP consent and audit signals

- In `src/routes/[.]lovable.oauth.consent.tsx`, surface the tool list and side-effecting categories at consent time, plus a summary of the key guardrails (daily/lifetime caps). Store the approved `client_id` in `public.oauth_clients` or audit logs.
- Add an MCP-specific audit event type (`mcp_tool_call` or extend `audit_logs`) that records tool name, client id, and confirmation state per MCP invocation, so the admin dashboard shows not just HTTP usage but which MCP client did what.
- Add a `tools/call` rate limit per MCP client/session in addition to the per-key HTTP rate limit.

### 4. Document the security model for operators

- Add a "Security" or "Best practices" section to `/docs` explaining: key allowlists, tool visibility, confirmation gates, spend guardrails, and how to revoke an MCP client from the console.
- Update `/connect` to recommend creating a dedicated key with a tight tool allowlist and low daily cap for MCP connections, and to show that side-effecting tools still require confirmation per call.

## Outcome

After this pass, the public site no longer oversells the current tool set as a broad marketplace, the MCP connection surface is scoped to tools the workspace actually wants exposed, and operators have clear controls and audit logs for high-risk tools.

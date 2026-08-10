# AI Agent Workspace

An authenticated, multi-tenant workspace where members of an organization chat with an AI agent that can call typed tools, with full history, tool timelines, and safety confirmations.

## What gets built

**Auth & organizations**

- Sign in with email/password and Google.
- Every user belongs to one or more organizations; a personal org is created on first sign-in.
- All conversations, messages, jobs, and audit logs are scoped to an organization. Members only ever see their org's data, enforced in the database itself.

**Chat workspace**

- Sidebar with the org switcher and a list of threads (create, rename, delete).
- Each thread has its own URL, so refreshing or sharing a link restores that thread.
- Streaming assistant replies with a live "thinking" indicator, markdown rendering, stop/cancel button, and retry on the last turn.
- Task progress strip showing the current job status (queued, running, waiting for confirmation, done, failed).

**Tool timeline**

- Every tool invocation appears inline in the assistant message: tool name, icon, status, collapsed inputs, and a compact result view.
- Read-only tools (search knowledge base, look up CRM record, list records) run automatically.
- Side-effecting tools (send email, update CRM, create payment, delete record) pause and render a confirmation card with the exact arguments. Nothing happens until the user approves; deny returns a refusal to the model so it can continue.
- Tools are simulated behind a typed contract layer so real providers can be dropped in later without touching the UI or the agent loop.

**Safety & reliability**

- Single client endpoint: `POST /api/agent`. No model keys ever reach the browser.
- Request validation on every field, per-user and per-org rate limits, and idempotency keys so a retried request never duplicates a message or a tool side effect.
- Structured server logs with request id, org id, user id, conversation id, tool name, latency, and outcome.
- Audit log row for every side-effecting tool decision (proposed, approved, denied, executed, failed).
- Clear error states in the UI for rate limit, validation failure, model error, cancelled, and network loss, each with a retry affordance.

## API contract

`POST /api/agent` accepts `{ conversationId?, orgId, message, idempotencyKey, confirm? }` and responds with:

```text
{ conversationId, messageId, status, content, toolCalls, error }
```

The same shape is used for the streamed final frame, so the client has one response model. `status` is one of `streaming | awaiting_confirmation | complete | error | cancelled`.

## Technical notes

- Lovable Cloud provides the database, auth, and secrets. The agent route is a TanStack server route at `src/routes/api/agent.ts`; the model is called server-side through the Lovable AI Gateway, streaming back a UI message stream.
- Tables: `organizations`, `org_members`, `conversations`, `messages`, `tool_calls`, `jobs`, `audit_logs`, `idempotency_keys`. RLS on all of them, using a `has_org_access(org_id)` security-definer function to avoid recursive policies; explicit grants per table.
- Tool contracts live in a shared registry with Zod schemas, a `sideEffecting` flag, and a description; the same registry feeds the model's tool definitions and the client's rendering of each call.
- Confirmation flow persists the pending tool call, returns `awaiting_confirmation`, and resumes on a follow-up `POST /api/agent` with the confirmation decision.
- Chat UI is composed from AI Elements primitives (conversation, message, prompt input, tool, shimmer) with a custom visual direction.
- Rate limiting and idempotency are enforced in the database so they hold across serverless instances.

## Verification before finishing

Create two orgs and two threads, send messages in each, reload, trigger a read-only tool and a side-effecting tool, confirm and deny one each, and check that a second org's user cannot read the first org's rows.

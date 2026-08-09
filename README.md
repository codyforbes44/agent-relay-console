# Agent Hub

Build an authenticated AI-agent workspace.

Create a chat interface with streaming responses, task progress, tool-call timeline,

retry/cancel controls, and persisted conversation history. The client must call only

POST /api/agent. Do not expose model-provider or third-party API keys in the browser.

Use Supabase auth and enforce tenant-scoped RLS for conversations, messages, jobs,

and audit logs. The API returns:

{ conversationId, messageId, status, content, toolCalls, error }

Implement typed tool contracts and show each tool invocation to the user. Require

explicit confirmation before side-effecting tools such as sending email, updating a

CRM, creating payments, or deleting records. Add rate limiting, request validation,

idempotency keys, structured logs, and error states.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://agent-relay-console.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/bcb8aa89-c5d8-49f9-ae4d-7c250103809e).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

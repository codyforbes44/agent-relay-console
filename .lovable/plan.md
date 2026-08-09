# Close the confirmation-gate loophole and fix catalog schemas

Your read of the catalog is accurate. I verified each item in the code:

- `toolDescriptor()` pre-sets `x-confirm-side-effects: true` in the example headers for every side-effecting tool, so a copy-pasting agent never sees the 428.
- The gate is a bare header check — no binding between the preview an operator saw and the confirmed call.
- `update_crm_record.fields` is `z.string()` ("JSON object … as a string"); `list_records.status` is required-but-nullable; there is no pagination cursor.

## 1. Bound confirmation tokens (replaces the bare header)

A side-effecting call without authorization returns 428 `confirmation_required` with `error.preview` **and** `error.confirmationToken`:

- The token is stored server-side with: workspace, key, tool, a hash of the canonical (sorted) validated args, an expiry (default 10 minutes), and a single-redemption flag.
- To execute, the agent retries with `x-confirmation-token: <token>` (the raw `x-confirm-side-effects: true` header stops authorizing anything).
- Mismatched args → 409 `confirmation_mismatch`. Expired → 410 `confirmation_expired`. Reused → 409 `confirmation_used`. Each error states the recovery action, matching the existing catalog style.
- Redeemed tokens double as an idempotency anchor: replaying the same token returns the stored response rather than executing twice.
- Human-in-the-loop stays possible: the pending confirmation is written where the console can show it, and the workspace `confirmation_default` setting (`side_effecting` / `all` / `none`) continues to decide which calls are gated.

This is what makes the "explicit confirmation" claim true even when the agent is self-funding through x402: it can pay, but it cannot fabricate an approval for arguments it never previewed.

## 2. Examples teach the two-step flow

Catalog, OpenAPI, `llms.txt`, and the docs page all show, for side-effecting tools:

```text
POST /tools/send_email            -> 428 confirmation_required { preview, confirmationToken }
POST /tools/send_email  + token   -> 200 { ok, result }
```

No example carries a pre-set confirmation header. OpenAPI marks `x-confirmation-token` as the authorizing header (obtained from the 428), never a static `true`. The homepage and docs copy get the same two-step framing.

## 3. Schema fixes

- `update_crm_record.fields` becomes a real object schema (free-form key/value), not stringified JSON; example and example result updated to match.
- `list_records.status` becomes optional (omit to mean "no filter") instead of required-but-nullable.
- `list_records` gains `limit` and `cursor`, and the result gains `nextCursor` (null when exhausted) so paging is expressible; the demo fixture honours both.

## 4. MCP transport parity

The MCP tool definitions get the same story as REST: side-effecting tools declare `destructiveHint`, and their handlers run the identical token gate — first call returns the preview plus token, the follow-up call carries the token as an argument. Descriptions state the two-step flow so an MCP client can't skip it either.

## Technical notes

- New table `public.tool_confirmations` (org, key, tool, args hash, preview, status, expiry, redeemed-at) with tenant-scoped access; GRANTs to `authenticated` and `service_role`; server-side writes via the admin client.
- Shared helper `src/lib/api/confirmations.server.ts`: `issueConfirmation`, `redeemConfirmation`, canonical-args hashing (sorted keys, SHA-256).
- Wired into `src/routes/api/public/v1/tools.$toolName.ts` (REST) and `src/lib/mcp/runtime.ts` (MCP).
- Catalog/OpenAPI/docs surfaces updated in `src/lib/api/catalog.server.ts`, `src/routes/docs.tsx`, `src/routes/llms[.]txt.ts`, `src/routes/index.tsx`, `src/components/public/TryToolPanel.tsx`, plus `scripts/check-api-consistency.mjs` so CI fails if an example ever re-introduces a pre-confirmed request.
- Catalog `version` bumps to today's date; error catalog gains the four new codes with cause + action.

## Not included

Enabling the Agent Hub connector in your chat — that is a toggle on your side, not a code change. Once the above ships, MCP Inspector or the connector will show the annotations and gated handlers described in section 4.

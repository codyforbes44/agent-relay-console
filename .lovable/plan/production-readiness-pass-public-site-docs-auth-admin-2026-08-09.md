# Production-readiness pass: public site, docs, auth, admin

A polish pass across everything a first-time visitor (human or agent) sees, plus the
operator surfaces behind login. No backend contract changes — the API shape, tool
catalog, pricing and billing logic stay exactly as they are.

## 1. Shared public chrome

- Add a mobile nav to `PublicShell`. Today the header nav is `hidden sm:flex`, so on
  phones there is no way to reach Docs, Pricing, Connect or the tool catalog — only the
  sign-in button. Add a sheet/drawer menu with the same links.
- Add a skip-to-content link and make sure each public route renders exactly one `<main>`.
- Header sign-in button reads session once on mount; make it react to auth state changes
  so it flips to "Open console" without a reload.
- Footer: add Connect, llms.txt, status of the MCP endpoint, and a "Security" link group
  so machine-discovery assets are reachable from every page.

## 2. Homepage

- Tighten the hero to lead with the single differentiator (agents self-onboard with one
  unauthenticated POST) and add a second CTA aimed at agents (`/llms.txt`) alongside the
  human CTAs.
- Add a short "How it works" three-step band (signup → discover → call) between the hero
  quickstart and the feature grid, so the page answers the flow before the feature list.
- Add a "Connect your client" strip pointing at `/connect` (ChatGPT, Claude, Cursor, MCP).
- Keep the tool catalog and pricing sections; add the free-credit and confirmation-gate
  facts as inline badges rather than prose repetition.

## 3. Public pages sweep

- `pricing`, `privacy`, `terms`, `refunds`, `connect`, `docs`: verify each has a unique
  title/description via `publicHead`, one H1, self-referencing canonical and og:url, and
  a visible last-updated date on the three legal pages.
- Legal pages: consistent business name ("Agent Relay Console"), contact address, and a
  cross-link block between Terms / Refunds / Privacy.
- `pricing`: add a per-tool cost table with USD-equivalent so the credit price is
  concrete, plus an FAQ block (credit expiry, refunds, x402/USDC option).
- `connect`: add Cursor and generic MCP client instructions next to the existing ChatGPT
  and Claude sections, and surface the OAuth flow note.

## 4. AI-agent-facing information

- Cross-check `llms.txt`, `.well-known/agent-manifest.json`, the OpenAPI document and the
  docs tool catalog against `PUBLIC_TOOLS` so every tool, credit price, side-effect flag
  and error code matches in all four places. Run the existing
  `scripts/check-api-consistency.mjs` and fix whatever it reports.
- Ensure the manifest and llms.txt advertise: self-signup, key rotation, claim flow,
  credit purchase (Paddle + x402/USDC on Base), MCP URL, and the confirmation header.
- Docs: add a top-of-page "Agent quickstart in 4 calls" block and make the error table the
  single canonical reference (remove any duplicated error prose elsewhere on the page).

## 5. Auth

- Auth page gets the public shell chrome (logo, back to home) instead of a bare form, plus
  clearer error states and a link to Terms/Privacy under the sign-up button.
- Add sign-out hygiene in the console shell: cancel in-flight queries, clear the query
  cache, sign out, then navigate to `/auth` with history replace.
- Verify all redirect URLs resolve through `authRedirectUrl()` so sign-in works on the
  canonical domain and inside preview.

## 6. Super admin

- Add a top KPI row: workspaces, active keys, credits outstanding, 24h calls, 24h revenue.
- Add search/filter on the workspaces and users tables, and pagination for large lists.
- Make destructive actions (revoke key, adjust credits, change role) go through a
  confirmation dialog with the target named, matching the product's own side-effect
  posture.
- Show recent audit-log entries and recent failed calls so the operator can triage without
  querying the database.

## 7. Verification

- Typecheck, run the API consistency script, and load every public route plus the admin
  page in a headless browser at mobile and desktop widths to confirm no console errors and
  no layout breaks.

## Technical notes

- Purely frontend/presentation plus metadata; no migrations, no changes to
  `src/lib/agent/contracts.ts` tool definitions, pricing values, or route handlers except
  where a doc/manifest string is factually wrong.
- Mobile nav uses the existing shadcn `sheet` primitive; confirmation dialogs use
  `alert-dialog`. Colors stay on existing semantic tokens.

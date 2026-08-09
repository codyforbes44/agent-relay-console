# Advice: what this landscape means for RELAY

The brief describes two worlds. World 1 (headless browsers, password managers, disposable-email signup loops, TOTP, CAPTCHA hand-offs) is agents brute-forcing their way through human UIs. World 2 (OAuth tokens, MCP, machine-readable capability discovery) is the web meeting agents halfway.

RELAY is already built for World 2: metered HTTP + MCP tool API, bearer keys, OpenAPI discovery, confirmation gates. The advice is simple: do not build browser automation, credential vaulting, or CAPTCHA solving. That is a crowded, legally exposed, high-maintenance category (Browserbase, Steel, Browser Use, Skyvern already own it) and it is orthogonal to a pay-per-call tool API.

The one genuinely valuable insight in the brief is source [6]: agents can pay, discover tools, and talk to each other — but they still cannot **sign up** for your product. That is RELAY's actual gap. Today a key only exists after a human logs in with Google and clicks around the console. An agent that discovers `/.well-known/agent-manifest.json` hits a wall immediately.

Closing that gap is the highest-leverage, lowest-cost move available, and it fits the fast-revenue goal: agent self-serve signup → free trial credits → 402 → card.

## What to build

**1. Agent self-serve signup (the core change)**

`POST /api/public/v1/signup` — no auth required. Body: an optional agent label and an optional contact email. Response: a one-time-visible API key, a workspace id, and a starter credit grant. No email verification, no CAPTCHA, no human console visit. Abuse control is credits, not gates: the free grant is small, the key is rate limited, and one signup per source IP/fingerprint per window.

Behind the scenes each signup creates a real organization row with a synthetic owner so all existing RLS, metering, and ledger code keeps working unchanged.

**2. Key lifecycle without a browser**

- `POST /api/public/v1/keys/rotate` — authenticated with the current key, returns a new one and revokes the old after a short overlap.
- `GET /api/public/v1/me` already reports balance; extend it with the free-grant state and a top-up URL so a 402 response tells the agent exactly where to send its human.

**3. Claim flow (agent → human → payment)**

An agent-created workspace starts unowned. `POST /api/public/v1/claim` returns a short-lived claim URL. The agent surfaces that URL to its operator, the human signs in with Google, and the workspace binds to their account and unlocks billing. This is the conversion path: the agent does the trying, the human does the paying.

**4. Discovery for agent crawlers**

- Advertise the signup, claim, and top-up endpoints in `/.well-known/agent-manifest.json` and the OpenAPI spec.
- Add `/llms.txt` describing in plain text how an agent onboards in three calls.
- Explicitly allow AI crawlers in `robots.txt` for public routes.
- A "For agents" section in the docs with a copy-paste three-call quickstart: signup, discover tools, invoke.

**5. Position the messaging around it**

Homepage and docs get one clear line: agents onboard themselves here — no browser, no password, no email loop. That is the differentiator against every tool API that still requires a dashboard visit.

## Deliberately out of scope

Headless browser sessions, credential storage, TOTP generation, disposable-email provisioning, CAPTCHA solving, residential proxies. If a customer needs those, they use a browser-agent platform and call RELAY tools from inside it.

## Technical notes

- New migration: nullable owner on organizations plus a `claim_tokens` table (hashed token, expiry, single use). Grants and RLS per project convention; the public routes use the admin client only after validating input, and never expose the service role.
- Signup and claim routes live under `src/routes/api/public/v1/` so the platform access gate leaves them open; both validate with Zod and share the existing rate limiter keyed on IP rather than key id.
- Free-grant credits are written through the existing `credit_ledger` path so balances and audit logs stay consistent.
- The starter grant amount, per-IP signup limit, and claim-token TTL live in one config module so they are tunable without touching route code.

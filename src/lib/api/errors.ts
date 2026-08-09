/**
 * Single source of truth for public API error codes. Rendered as the docs
 * error reference table, published in the OpenAPI document and asserted by
 * the API consistency check (`scripts/check-api-consistency.mjs`).
 */
export type ApiErrorSpec = {
  status: number;
  code: string;
  /** Why the API returned this. */
  cause: string;
  /** What the caller should do next. */
  action: string;
  /** True when the call is safe to retry unchanged (after backoff). */
  retryable: boolean;
  /** Extra fields present on the error body beyond code/message. */
  extra?: string[];
};

export const API_ERRORS: ApiErrorSpec[] = [
  {
    status: 401,
    code: "missing_api_key",
    cause: "No Authorization: Bearer header on the request.",
    action: "Send Authorization: Bearer sk_agent_… , or POST /api/public/v1/signup to mint a key.",
    retryable: false,
  },
  {
    status: 401,
    code: "invalid_api_key",
    cause: "The key is unknown, revoked, or past its rotation grace window.",
    action: "Rotate with POST /api/public/v1/keys/rotate, or create a new key in the console.",
    retryable: false,
  },
  {
    status: 402,
    code: "insufficient_credits",
    cause: "The workspace balance is below this tool's price. Nothing was executed or charged.",
    action:
      "Top up: POST /api/public/v1/claim returns a claim URL for your human operator to buy credits.",
    retryable: false,
    extra: ["required", "balance"],
  },
  {
    status: 403,
    code: "insufficient_scope",
    cause: "The key is valid but does not carry the tools:invoke scope.",
    action: "Issue a key with tools:invoke from the console and retry with it.",
    retryable: false,
  },
  {
    status: 404,
    code: "unknown_tool",
    cause: "No public tool with that name exists in the catalog.",
    action: "Re-read GET /api/public/v1/tools and use an exact name from the catalog.",
    retryable: false,
  },
  {
    status: 409,
    code: "request_in_progress",
    cause: "Another call with the same idempotency-key is still executing.",
    action: "Wait and retry the same key to receive the stored response; do not change the body.",
    retryable: true,
  },
  {
    status: 422,
    code: "invalid_json",
    cause: "The request body was not valid JSON.",
    action: "Send a JSON object with content-type: application/json.",
    retryable: false,
  },
  {
    status: 422,
    code: "invalid_input",
    cause: "Arguments failed the tool's JSON Schema. No credits were charged.",
    action: "Fix the fields listed in error.issues[].path and resend.",
    retryable: false,
    extra: ["issues"],
  },
  {
    status: 428,
    code: "confirmation_required",
    cause: "A side-effecting tool was called without explicit authorization.",
    action:
      "Show error.preview to your operator, then repeat the call with x-confirm-side-effects: true.",
    retryable: true,
    extra: ["tool", "credits", "preview"],
  },
  {
    status: 429,
    code: "rate_limited",
    cause: "Over 60 calls per minute for this API key.",
    action: "Back off ~1 minute, or mint additional keys for parallel workers.",
    retryable: true,
  },
  {
    status: 429,
    code: "signup_rate_limited",
    cause: "More than 3 workspaces created from this address in 24 hours (signup only).",
    action: "Reuse the key you already have, or have your operator claim an existing workspace.",
    retryable: false,
  },
  {
    status: 502,
    code: "tool_failed",
    cause: "The upstream tool threw while executing. Credits are not deducted.",
    action: "Retry with backoff; if it persists the integration is down — check status and report.",
    retryable: true,
  },
];

/** Error codes reachable from POST /api/public/v1/tools/{name}. */
export const TOOL_ERRORS = API_ERRORS.filter((e) => e.code !== "signup_rate_limited");

export const ERROR_ENVELOPE_EXAMPLE = {
  ok: false,
  error: {
    code: "insufficient_credits",
    message: "Not enough credits for this call",
    required: 5,
    balance: 2,
  },
};

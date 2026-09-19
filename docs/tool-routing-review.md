# Tool routing and discovery repair

`execute_code` and `browse_page` had public contracts and provider implementations
but no dispatcher cases. Both now route to their existing provider adapters.
Missing provider configuration still fails without performing provider work.

MCP now registers the same fourteen public tools as HTTP discovery, adding
`search_web`, `search_knowledge_base`, `execute_code`, and `browse_page`. MCP passes
the authenticated workspace ID to the dispatcher, overriding any caller-supplied
workspace value. The existing metering/refund/confirmation layer remains in place.

Code execution is marked side-effecting: an isolated filesystem does not prevent
external network effects. It therefore follows the existing configured confirmation
policy. Browserbase rendering uses a cloud browser, not a local signed-in browser.
The seven sandbox demo tools remain simulations.

Validation: run the Vitest suite, `npm run typecheck`, and `npm run build`. Run
`npx lovable-mcp-extract-manifest` with the correct VITE_SUPABASE_PROJECT_ID to
regenerate the committed MCP manifest; the build only generates routes. Review
the generated catalog and OAuth issuer alongside the source. The API consistency
checker now reads the SDK's nested manifest catalog and rejects missing catalogs.
Provider regression tests mock E2B and Browserbase and make no paid requests.

Before deployment, verify provider configuration and run the existing API consistency
check against staging. Production provider health and account ownership are not
established by these tests. No live provider keys or account configuration are changed
by this patch.

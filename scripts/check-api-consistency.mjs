#!/usr/bin/env node
/**
 * API consistency check.
 *
 * Diffs the live implementation (catalog, OpenAPI, agent manifest, MCP
 * manifest, llms.txt and the rendered docs page) against the typed contract
 * registry in src/lib/agent/contracts.ts and the error reference in
 * src/lib/api/errors.ts. Fails the build when any surface drifts.
 *
 * Usage: node scripts/check-api-consistency.mjs [baseUrl]
 *   baseUrl defaults to http://localhost:8080
 */
import { readFileSync } from "node:fs";

const BASE = (process.argv[2] || process.env.CHECK_BASE_URL || "http://localhost:8080").replace(
  /\/$/,
  "",
);

const failures = [];
const fail = (msg) => failures.push(msg);

/** Parse the contract registry without a TS toolchain: read the literals. */
function parseContracts() {
  const src = readFileSync(new URL("../src/lib/agent/contracts.ts", import.meta.url), "utf8");
  const blocks = src.split(/\n  \{\n/).slice(1);
  const tools = [];
  for (const block of blocks) {
    const name = /name: "([a-z_]+)"/.exec(block)?.[1];
    if (!name) continue;
    const credits = Number(/credits: (\d+)/.exec(block)?.[1]);
    const sideEffecting = /sideEffecting: (true|false)/.exec(block)?.[1] === "true";
    const publicApi = /publicApi: (true|false)/.exec(block)?.[1] === "true";
    const hasExample = /\n    example: \{/.test(block);
    const hasExampleResult = /\n    exampleResult: \{/.test(block);
    tools.push({ name, credits, sideEffecting, publicApi, hasExample, hasExampleResult });
  }
  return tools;
}

function parseErrorCodes() {
  const src = readFileSync(new URL("../src/lib/api/errors.ts", import.meta.url), "utf8");
  return [...src.matchAll(/status: (\d+),\n {4}code: "([a-z_]+)"/g)].map((m) => ({
    status: Number(m[1]),
    code: m[2],
  }));
}

async function get(path, { json = true } = {}) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return json ? res.json() : res.text();
}

const contracts = parseContracts();
const publicTools = contracts.filter((t) => t.publicApi);
const errors = parseErrorCodes();

for (const t of contracts) {
  if (!t.hasExample) fail(`contract ${t.name}: missing example request payload`);
  if (!t.hasExampleResult) fail(`contract ${t.name}: missing exampleResult payload`);
}

// 1. Public catalog
const catalog = await get("/api/public/v1/tools");
const catalogNames = catalog.tools.map((t) => t.name).sort();
const expectedNames = publicTools.map((t) => t.name).sort();
if (catalogNames.join(",") !== expectedNames.join(",")) {
  fail(`catalog tools mismatch: live [${catalogNames}] vs contracts [${expectedNames}]`);
}
for (const tool of catalog.tools) {
  const c = publicTools.find((x) => x.name === tool.name);
  if (!c) continue;
  if (tool.credits !== c.credits) fail(`catalog ${tool.name}: credits ${tool.credits} ≠ ${c.credits}`);
  if (tool.sideEffecting !== c.sideEffecting) fail(`catalog ${tool.name}: sideEffecting drift`);
  if (!tool.inputSchema?.properties) fail(`catalog ${tool.name}: missing inputSchema`);
  if (!tool.example?.request?.body) fail(`catalog ${tool.name}: missing example.request.body`);
  if (!tool.example?.response?.result) fail(`catalog ${tool.name}: missing example.response.result`);
  if (!Array.isArray(tool.example?.errors) || tool.example.errors.length === 0) {
    fail(`catalog ${tool.name}: missing example.errors`);
  }
  // Examples must never teach agents to pre-confirm: no example may carry a
  // confirmation header up front, and side-effecting tools must publish the
  // two-step 428 -> token flow.
  if (JSON.stringify(tool.example ?? {}).includes("x-confirm-side-effects")) {
    fail(`catalog ${tool.name}: example still uses the removed x-confirm-side-effects header`);
  }
  if (tool.example?.request?.headers?.["x-confirmation-token"]) {
    fail(`catalog ${tool.name}: canonical example must not be pre-confirmed`);
  }
  if (tool.sideEffecting) {
    const steps = tool.confirmation?.steps;
    if (tool.confirmation?.header !== "x-confirmation-token" || !Array.isArray(steps) || steps.length !== 2) {
      fail(`catalog ${tool.name}: missing two-step confirmation flow`);
    } else {
      if (steps[0]?.response?.status !== 428 || !steps[0]?.response?.body?.error?.confirmationToken) {
        fail(`catalog ${tool.name}: step 1 must return 428 with a confirmationToken`);
      }
      if (!steps[1]?.request?.headers?.["x-confirmation-token"]) {
        fail(`catalog ${tool.name}: step 2 must send x-confirmation-token`);
      }
      if (JSON.stringify(steps[0]?.request?.body) !== JSON.stringify(steps[1]?.request?.body)) {
        fail(`catalog ${tool.name}: confirmation steps must use identical bodies`);
      }
    }
  } else if (tool.confirmation?.required !== false) {
    fail(`catalog ${tool.name}: read-only tool should not require confirmation`);
  }
}

// 1b. Product invariants: the catalog must always sell something, and every
// billable tool must be serialized with its price. This is what a cold agent
// reads before deciding whether the API is worth paying for.
const billableContracts = publicTools.filter((t) => t.credits > 0);
if (billableContracts.length === 0) {
  fail("catalog: no billable public tool exists — the marketplace has nothing to sell");
}
for (const c of billableContracts) {
  const tool = catalog.tools.find((t) => t.name === c.name);
  if (!tool) continue;
  if (!(tool.credits > 0)) fail(`catalog ${c.name}: billable tool serialized with credits ${tool.credits}`);
  if (!(Number(tool.usdPerCall) > 0)) {
    fail(`catalog ${c.name}: billable tool missing a positive usdPerCall (got ${tool.usdPerCall})`);
  }
}

// 1c. Pricing block shape — each field fails individually.
const pricing = catalog.pricing;
if (!pricing) {
  fail("catalog: missing top-level pricing block");
} else {
  if (pricing.unit !== "credit") fail(`catalog pricing: unit should be "credit" (got ${pricing.unit})`);
  if (pricing.currency !== "USD") fail(`catalog pricing: currency should be "USD" (got ${pricing.currency})`);
  if (!(Number(pricing.usdPerCredit) > 0)) fail("catalog pricing: usdPerCredit missing or not positive");
  if (typeof pricing.freeGrant !== "number") fail("catalog pricing: freeGrant missing");
  if (!Array.isArray(pricing.packs) || pricing.packs.length === 0) fail("catalog pricing: packs[] is empty");
  if (!pricing.purchase) fail("catalog pricing: purchase block missing");
  if (!pricing.pricingUrl) fail("catalog pricing: pricingUrl missing");
}

// 2. OpenAPI document
const openapi = await get("/api/public/v1/openapi.json");
for (const t of publicTools) {
  const op = openapi.paths?.[`/api/public/v1/tools/${t.name}`]?.post;
  if (!op) {
    fail(`openapi: no path for ${t.name}`);
    continue;
  }
  const reqExample = op.requestBody?.content?.["application/json"]?.examples?.default?.value;
  if (!reqExample) fail(`openapi ${t.name}: missing request example`);
  if (!op.responses?.["200"]?.content?.["application/json"]?.examples) {
    fail(`openapi ${t.name}: missing 200 example`);
  }
  const relevant = errors.filter((e) => t.sideEffecting || !e.code.startsWith("confirmation_"));
  for (const e of relevant) {
    if (e.code === "signup_rate_limited") continue;
    const res = op.responses?.[String(e.status)];
    if (!res) fail(`openapi ${t.name}: no ${e.status} response documented`);
    else if (!JSON.stringify(res).includes(e.code)) {
      fail(`openapi ${t.name}: ${e.status} response does not mention ${e.code}`);
    }
  }
  const confirmParam = (op.parameters || []).find((p) => p.name === "x-confirmation-token");
  if (Boolean(confirmParam) !== t.sideEffecting) {
    fail(`openapi ${t.name}: confirmation parameter disagrees with sideEffecting`);
  }
  if (confirmParam?.required) {
    fail(`openapi ${t.name}: confirmation header must be optional (first call has no token)`);
  }
  if (!String(op.description || "").includes(`${t.credits} credit`)) {
    fail(`openapi ${t.name}: description does not state ${t.credits} credits`);
  }
}
for (const p of ["/api/public/v1/signup", "/api/public/v1/claim", "/api/public/v1/keys/rotate", "/api/public/v1/me", "/api/public/v1/tools"]) {
  if (!openapi.paths?.[p]) fail(`openapi: missing onboarding path ${p}`);
}

// 3. Agent manifest
const manifest = await get("/.well-known/agent-manifest.json");
const manifestText = JSON.stringify(manifest);
if (!manifest.auth?.signup_url) fail("agent manifest: missing auth.signup_url");
for (const t of publicTools) {
  if (!manifestText.includes(t.name) && !manifestText.includes("/api/public/v1/tools")) {
    fail(`agent manifest: no reference to ${t.name} or the catalog endpoint`);
  }
}

// 4. MCP manifest (generated at build time)
try {
  const mcp = JSON.parse(
    readFileSync(new URL("../.lovable/mcp/manifest.json", import.meta.url), "utf8"),
  );
  const mcpNames = (mcp.tools || []).map((t) => t.name).sort();
  if (mcpNames.length && mcpNames.join(",") !== expectedNames.join(",")) {
    fail(`mcp manifest tools mismatch: [${mcpNames}] vs [${expectedNames}]`);
  }
  for (const t of mcp.tools || []) {
    const c = publicTools.find((x) => x.name === t.name);
    if (c && !String(t.description || "").includes(`${c.credits} credit`)) {
      fail(`mcp ${t.name}: description does not state ${c.credits} credits`);
    }
    if (c && !String(t.description || "").includes("Example arguments")) {
      fail(`mcp ${t.name}: description has no example arguments`);
    }
  }
} catch (e) {
  fail(`mcp manifest unreadable: ${e.message}`);
}

// 5. Docs page + llms.txt
const docs = await get("/docs", { json: false });
for (const t of publicTools) {
  if (!docs.includes(t.name)) fail(`docs page: tool ${t.name} is not documented`);
  const badge = new RegExp(`${t.credits}(<!-- -->)? cr`);
  if (!badge.test(docs)) fail(`docs page: no credit badge for ${t.credits} cr`);
}
for (const e of errors) {
  if (!docs.includes(e.code)) fail(`docs page: error code ${e.code} missing from reference table`);
}
const llms = await get("/llms.txt", { json: false });
if (!llms.includes("/api/public/v1/signup")) fail("llms.txt: signup endpoint missing");

if (failures.length) {
  console.error(`\nAPI consistency check FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(
  `API consistency check passed — ${publicTools.length} tools, ${errors.length} error codes, ${BASE}`,
);

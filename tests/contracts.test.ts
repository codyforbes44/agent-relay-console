import { describe, expect, it } from "vitest";

import { DEPRECATED_TOOL_ALIASES, resolveTool, TOOL_CONTRACTS } from "@/lib/agent/contracts";
import { requiresConfirmation } from "@/lib/api/settings.server";
import { budgetViolation } from "@/lib/api/metering.server";

describe("tool contract registry", () => {
  it("resolves deprecated aliases to canonical names", () => {
    for (const [alias, canonical] of Object.entries(DEPRECATED_TOOL_ALIASES)) {
      const resolved = resolveTool(alias);
      expect(resolved.canonicalName).toBe(canonical);
      expect(resolved.deprecatedAlias).toBe(alias);
      expect(resolved.tool?.name).toBe(canonical);
    }
  });

  it("resolves canonical names without a deprecation marker", () => {
    const resolved = resolveTool("fetch_url");
    expect(resolved.deprecatedAlias).toBeNull();
    expect(resolved.tool?.name).toBe("fetch_url");
  });

  it("returns undefined for unknown tools", () => {
    expect(resolveTool("no_such_tool").tool).toBeUndefined();
  });

  it("gives every billable tool a positive credit price and every demo tool zero", () => {
    for (const t of TOOL_CONTRACTS) {
      if (t.demo) expect(t.credits).toBe(0);
      else expect(t.credits).toBeGreaterThan(0);
    }
  });

  it("keeps summarize() total for every contract's own example", () => {
    for (const t of TOOL_CONTRACTS) {
      expect(() => t.summarize(t.example)).not.toThrow();
      expect(typeof t.summarize(t.example)).toBe("string");
    }
  });

  it("accepts each contract's published example against its schema", () => {
    for (const t of TOOL_CONTRACTS) {
      const parsed = t.schema.safeParse(t.example);
      expect(parsed.success, `${t.name} example must satisfy its own schema`).toBe(true);
    }
  });
});

describe("requiresConfirmation", () => {
  it("follows the side-effect flag in the default mode", () => {
    expect(requiresConfirmation("side_effecting", true)).toBe(true);
    expect(requiresConfirmation("side_effecting", false)).toBe(false);
  });

  it("mode all gates everything; mode none gates nothing", () => {
    expect(requiresConfirmation("all", false)).toBe(true);
    expect(requiresConfirmation("none", true)).toBe(false);
  });
});

describe("budgetViolation", () => {
  it("maps each budget window to a 403 with the spend context", () => {
    for (const window of ["call", "24h", "lifetime", "unknown"]) {
      const v = budgetViolation({ window, spent: 10, required: 5, limit: 12 });
      expect(v.status).toBe(403);
      expect(v.code).toBe("budget_exceeded");
      expect(v.extra).toMatchObject({ spent: 10, required: 5, limit: 12, window });
    }
  });
});

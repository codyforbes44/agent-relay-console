import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("@lovable.dev/mcp-js", () => ({
  defineMcp: (config: unknown) => config,
  auth: { oauth: { issuer: (config: unknown) => config } },
}));
vi.mock("@/lib/mcp/runtime", () => ({ mcpToolFor: (name: string) => ({ name }) }));

import { PUBLIC_TOOLS } from "@/lib/agent/contracts";
import mcp from "@/lib/mcp";

it("registers every public tool exactly once for MCP discovery", () => {
  const config = mcp as unknown as { tools: Array<{ name: string }> };
  expect(config.tools.map((tool) => tool.name).sort()).toEqual(
    PUBLIC_TOOLS.map((tool) => tool.name).sort(),
  );
});

it("keeps the committed SDK manifest aligned with the public catalog", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../.lovable/mcp/manifest.json", import.meta.url), "utf8"),
  );
  expect(manifest.mcp.tools.map((tool: { name: string }) => tool.name).sort()).toEqual(
    PUBLIC_TOOLS.map((tool) => tool.name).sort(),
  );
  const codeTool = manifest.mcp.tools.find(
    (tool: { name: string }) => tool.name === "execute_code",
  );
  expect(codeTool.annotations.readOnlyHint).toBe(false);
  expect(codeTool.inputSchema.properties).toHaveProperty("confirmation_token");
});

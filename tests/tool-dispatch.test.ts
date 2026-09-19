import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({
  create: vi.fn(),
  write: vi.fn(),
  run: vi.fn(),
  kill: vi.fn(),
  fetchPage: vi.fn(),
}));

vi.mock("e2b", () => ({ Sandbox: { create: provider.create } }));
vi.mock("@browserbasehq/sdk", () => ({
  default: class {
    fetchAPI = { create: provider.fetchPage };
  },
}));

import { runTool } from "@/lib/agent/tools.server";

describe("cloud tool dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("E2B_API_KEY", "test-only-e2b");
    vi.stubEnv("BROWSERBASE_API_KEY", "test-only-browserbase");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Unexpected network request");
      }),
    );
    provider.create.mockResolvedValue({
      files: { write: provider.write },
      commands: { run: provider.run },
      kill: provider.kill,
    });
    provider.write.mockResolvedValue(undefined);
    provider.kill.mockResolvedValue(undefined);
    provider.run.mockResolvedValue({ stdout: "hello\n", stderr: "", exitCode: 0 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("dispatches code to the sandbox and always releases it", async () => {
    const result = await runTool("execute_code", { code: "print('hello')", timeout: 3 });
    expect(result).toMatchObject({ ok: true });
    expect(provider.write).toHaveBeenCalledWith(expect.stringMatching(/\.py$/), "print('hello')");
    expect(provider.run).toHaveBeenCalledWith(expect.stringMatching(/^python3 /), {
      timeoutMs: 3000,
    });
    expect(provider.kill).toHaveBeenCalledOnce();
  });

  it("releases the sandbox when execution fails", async () => {
    provider.run.mockRejectedValueOnce(new Error("sandbox unavailable"));
    expect(await runTool("execute_code", { code: "print('hello')" })).toEqual({
      ok: false,
      error: "sandbox unavailable",
    });
    expect(provider.kill).toHaveBeenCalledOnce();
  });

  it("dispatches browser rendering to the configured adapter", async () => {
    provider.fetchPage.mockResolvedValue({
      content: "# Example\nPage body",
      statusCode: 200,
      contentType: "text/markdown",
    });
    expect(await runTool("browse_page", { url: "https://example.com" })).toMatchObject({
      ok: true,
    });
    expect(provider.fetchPage).toHaveBeenCalledWith({
      url: "https://example.com",
      format: "markdown",
      allowRedirects: true,
    });
  });

  it("fails without provider configuration and performs no provider work", async () => {
    vi.stubEnv("E2B_API_KEY", "");
    vi.stubEnv("BROWSERBASE_API_KEY", "");
    expect(await runTool("execute_code", { code: "print('hello')" })).toEqual({
      ok: false,
      error: "Code execution is not configured",
    });
    expect(await runTool("browse_page", { url: "https://example.com" })).toEqual({
      ok: false,
      error: "Browser automation is not configured",
    });
    expect(provider.create).not.toHaveBeenCalled();
    expect(provider.fetchPage).not.toHaveBeenCalled();
  });

  it("still rejects unknown tools", async () => {
    expect(await runTool("no_such_tool", {})).toEqual({
      ok: false,
      error: "Unknown tool: no_such_tool",
    });
  });
});

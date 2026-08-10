import { describe, expect, it } from "vitest";

import { mintAgentKey, parseAgentKey, sha256Hex } from "@/lib/api/keys.server";

describe("agent API keys", () => {
  it("mints keys in the documented sk_agent_<prefix>_<secret> shape", async () => {
    const minted = await mintAgentKey();
    expect(minted.key).toMatch(/^sk_agent_[a-z0-9]{8}_[a-z0-9]{40}$/);
    expect(minted.key).toContain(minted.prefix);
  });

  it("stores only the hash of the secret", async () => {
    const minted = await mintAgentKey();
    const parsed = parseAgentKey(minted.key);
    expect(parsed).not.toBeNull();
    expect(await sha256Hex(parsed!.secret)).toBe(minted.hash);
    expect(minted.hash).not.toContain(parsed!.secret);
  });

  it("round-trips through parseAgentKey", async () => {
    const minted = await mintAgentKey();
    const parsed = parseAgentKey(minted.key);
    expect(parsed?.prefix).toBe(minted.prefix);
  });

  it("rejects malformed keys", () => {
    expect(parseAgentKey("")).toBeNull();
    expect(parseAgentKey("sk_agent_onlyprefix")).toBeNull();
    expect(parseAgentKey("sk_live_abcd1234_secret")).toBeNull();
    expect(parseAgentKey("bearer sk_agent_a_b_c")).toBeNull();
  });

  it("mints unique keys", async () => {
    const [a, b] = await Promise.all([mintAgentKey(), mintAgentKey()]);
    expect(a.key).not.toBe(b.key);
  });
});

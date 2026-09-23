import { describe, expect, it } from "vitest";

import {
  evaluatePolicy,
  sanitizeCallbackUrl,
  signWebhook,
  type ApprovalPolicy,
} from "@/lib/api/approvals.server";

function policy(overrides: Partial<ApprovalPolicy> = {}): ApprovalPolicy {
  return {
    orgId: "org_1",
    autoApproveMaxCredits: 0,
    autoApproveTools: [],
    requireHumanTools: [],
    defaultAction: "human",
    webhookSecret: "secret",
    notifyEmail: null,
    ...overrides,
  };
}

describe("approval policy evaluation", () => {
  it("defaults to human review", () => {
    expect(evaluatePolicy(policy(), "execute_code", 8)).toBe("human");
  });

  it("require_human_tools always wins over auto-approve", () => {
    const p = policy({
      autoApproveTools: ["sandbox_send_email"],
      requireHumanTools: ["sandbox_send_email"],
      defaultAction: "auto",
      autoApproveMaxCredits: 100,
    });
    expect(evaluatePolicy(p, "sandbox_send_email", 0)).toBe("human");
  });

  it("auto-approve allowlist bypasses the credit ceiling", () => {
    const p = policy({ autoApproveTools: ["execute_code"] });
    expect(evaluatePolicy(p, "execute_code", 500)).toBe("auto");
  });

  it("auto default approves under the credit ceiling only", () => {
    const p = policy({ defaultAction: "auto", autoApproveMaxCredits: 5 });
    expect(evaluatePolicy(p, "search_web", 4)).toBe("auto");
    expect(evaluatePolicy(p, "execute_code", 8)).toBe("human");
  });

  it("human default never auto-approves on credits alone", () => {
    const p = policy({ autoApproveMaxCredits: 1000 });
    expect(evaluatePolicy(p, "search_web", 1)).toBe("human");
  });
});

describe("callback URL sanitization", () => {
  it("accepts https URLs", () => {
    expect(sanitizeCallbackUrl("https://agent.example.com/hook")).toBe(
      "https://agent.example.com/hook",
    );
  });

  it("rejects plain http except loopback", () => {
    expect(sanitizeCallbackUrl("http://agent.example.com/hook")).toBeNull();
    expect(sanitizeCallbackUrl("http://localhost:3000/hook")).toBe("http://localhost:3000/hook");
  });

  it("rejects garbage and blanks", () => {
    expect(sanitizeCallbackUrl(null)).toBeNull();
    expect(sanitizeCallbackUrl("")).toBeNull();
    expect(sanitizeCallbackUrl("not a url")).toBeNull();
  });
});

describe("webhook signing", () => {
  it("produces a stable sha256= hex signature", async () => {
    const a = await signWebhook("s3cret", '{"a":1}');
    const b = await signWebhook("s3cret", '{"a":1}');
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("changes with the body or the secret", async () => {
    const a = await signWebhook("s3cret", '{"a":1}');
    expect(await signWebhook("s3cret", '{"a":2}')).not.toBe(a);
    expect(await signWebhook("other", '{"a":1}')).not.toBe(a);
  });
});

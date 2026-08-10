import { describe, expect, it } from "vitest";

import { argsHashInput, hashArgs } from "@/lib/api/confirmations.server";

describe("confirmation argument hashing", () => {
  it("is independent of object key order", async () => {
    const a = await hashArgs("sandbox_send_email", { to: "x@y.z", subject: "hi", body: "b" });
    const b = await hashArgs("sandbox_send_email", { body: "b", subject: "hi", to: "x@y.z" });
    expect(a).toBe(b);
  });

  it("canonicalizes nested objects recursively", () => {
    const a = argsHashInput("t", { outer: { b: 1, a: { d: 2, c: 3 } } });
    const b = argsHashInput("t", { outer: { a: { c: 3, d: 2 }, b: 1 } });
    expect(a).toBe(b);
  });

  it("preserves array order (reordering args must invalidate the token)", () => {
    const a = argsHashInput("t", { fields: ["name", "price"] });
    const b = argsHashInput("t", { fields: ["price", "name"] });
    expect(a).not.toBe(b);
  });

  it("binds the hash to the tool name", async () => {
    const args = { recordId: "r1" };
    const a = await hashArgs("sandbox_delete_record", args);
    const b = await hashArgs("sandbox_update_crm_record", args);
    expect(a).not.toBe(b);
  });

  it("changes when any argument value changes", async () => {
    const a = await hashArgs("sandbox_create_payment", { amountCents: 4200, customerId: "c1" });
    const b = await hashArgs("sandbox_create_payment", { amountCents: 4201, customerId: "c1" });
    expect(a).not.toBe(b);
  });
});

import { describe, expect, it } from "vitest";
import { parseInventoryOwnerPatch } from "./inventory-owner";

describe("parseInventoryOwnerPatch", () => {
  it("reads English fields and German aliases", () => {
    expect(parseInventoryOwnerPatch({ dismantlingOwner: "company", aufbau: "customer" })).toEqual({
      ok: true,
      patch: { dismantlingOwner: "company", assemblyOwner: "customer" },
    });
  });

  it("leaves omitted owners unchanged and rejects an invalid value", () => {
    expect(parseInventoryOwnerPatch({ name: "Sofa" })).toEqual({ ok: true, patch: {} });
    const bad = parseInventoryOwnerPatch({ abbau: "wir" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/company, customer, none/);
  });

  it("rejects a field and its alias when they disagree", () => {
    const bad = parseInventoryOwnerPatch({ assemblyOwner: "company", aufbau: "none" });
    expect(bad.ok).toBe(false);
  });
});

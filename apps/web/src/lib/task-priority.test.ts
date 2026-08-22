import { describe, it, expect } from "vitest";
import { PRIORITIES, normalizePriority, priorityMeta } from "./task-priority";

describe("task priority scale", () => {
  it("has four steps ordered high to low", () => {
    expect(PRIORITIES.map((p) => p.value)).toEqual(["sehr_hoch", "hoch", "mittel", "niedrig"]);
  });

  it("labels the new top step in German", () => {
    expect(PRIORITIES[0].label).toBe("Sehr hoch");
    expect(PRIORITIES[0].dot).toBe("#b91c1c");
  });

  it("gives every step a distinct dot colour", () => {
    const dots = PRIORITIES.map((p) => p.dot);
    expect(new Set(dots).size).toBe(dots.length);
  });
});

describe("normalizePriority", () => {
  it("accepts the new top step", () => {
    expect(normalizePriority("sehr_hoch")).toBe("sehr_hoch");
  });

  it("keeps the three existing values valid", () => {
    expect(normalizePriority("hoch")).toBe("hoch");
    expect(normalizePriority("mittel")).toBe("mittel");
    expect(normalizePriority("niedrig")).toBe("niedrig");
  });

  it("rejects anything else", () => {
    expect(normalizePriority("sehr hoch")).toBeNull();
    expect(normalizePriority("kritisch")).toBeNull();
    expect(normalizePriority(null)).toBeNull();
    expect(normalizePriority(undefined)).toBeNull();
    expect(normalizePriority(3)).toBeNull();
  });
});

describe("priorityMeta", () => {
  it("resolves the new step to its label and dot", () => {
    expect(priorityMeta("sehr_hoch")).toEqual({
      value: "sehr_hoch",
      label: "Sehr hoch",
      dot: "#b91c1c",
    });
  });

  it("returns null for null and for unknown values", () => {
    expect(priorityMeta(null)).toBeNull();
    expect(priorityMeta("kritisch")).toBeNull();
  });
});

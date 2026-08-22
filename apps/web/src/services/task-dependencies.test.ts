import { describe, expect, it } from "vitest";
import { wouldCreateCycle } from "./task-dependencies";

describe("wouldCreateCycle", () => {
  it("allows a fresh edge into an empty graph", () => {
    expect(wouldCreateCycle([], "a", "b")).toBe(false);
  });

  it("blocks the direct back-edge b→a when a→b exists", () => {
    const edges = [{ predecessorTaskId: "a", successorTaskId: "b" }];
    expect(wouldCreateCycle(edges, "b", "a")).toBe(true);
  });

  it("blocks a long cycle a→b→c→d, then d→a", () => {
    const edges = [
      { predecessorTaskId: "a", successorTaskId: "b" },
      { predecessorTaskId: "b", successorTaskId: "c" },
      { predecessorTaskId: "c", successorTaskId: "d" },
    ];
    expect(wouldCreateCycle(edges, "d", "a")).toBe(true);
  });

  it("allows a diamond — two paths to the same successor are not a cycle", () => {
    const edges = [
      { predecessorTaskId: "a", successorTaskId: "b" },
      { predecessorTaskId: "a", successorTaskId: "c" },
    ];
    expect(wouldCreateCycle(edges, "b", "d")).toBe(false);
    expect(wouldCreateCycle(edges, "c", "d")).toBe(false);
  });

  it("treats a self-link as a cycle", () => {
    expect(wouldCreateCycle([], "a", "a")).toBe(true);
  });

  it("does not hang on a graph that already contains a cycle", () => {
    const edges = [
      { predecessorTaskId: "x", successorTaskId: "y" },
      { predecessorTaskId: "y", successorTaskId: "x" },
    ];
    expect(wouldCreateCycle(edges, "z", "x")).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/services/inbox-whatsapp", () => ({ sendBaileysDirektText: vi.fn() }));

const { waehleAbsender } = await import("./link-senden");

describe("waehleAbsender", () => {
  it("erstes verbundenes Konto von Rümpeltürken/Ceylan, nie Kottke, nie getrennt", () => {
    expect(
      waehleAbsender([
        { id: "k", firmaName: "Kottke-Umzüge", status: "connected" },
        { id: "c-idle", firmaName: "Ceylan Operations", status: "idle" },
        { id: "c1", firmaName: "Ceylan Operations", status: "connected" },
        { id: "r2", firmaName: "Rümpeltürken", status: "connected" },
      ])
    ).toBe("c1");
    expect(waehleAbsender([{ id: "k", firmaName: "Kottke-Umzüge", status: "connected" }])).toBeNull();
    expect(waehleAbsender([{ id: "x", firmaName: null, status: "connected" }])).toBeNull();
    expect(waehleAbsender([])).toBeNull();
  });
});

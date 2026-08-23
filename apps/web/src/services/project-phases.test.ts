import { describe, expect, it } from "vitest";
import { resolvePhaseCreate, resolvePhaseUpdate, applyPhaseOrder } from "./project-phases";

describe("resolvePhaseCreate", () => {
  it("requires a name", () => {
    expect(resolvePhaseCreate({ description: "…" })).toEqual({
      ok: false,
      error: "Name ist erforderlich.",
    });
  });
  it("defaults the status to geplant", () => {
    expect(resolvePhaseCreate({ name: "Vorbereitung" })).toEqual({
      ok: true,
      values: { name: "Vorbereitung", description: null, startDate: null, dueDate: null, status: "geplant" },
    });
  });
  it("rejects an unknown status", () => {
    expect(resolvePhaseCreate({ name: "X", status: "erledigt" })).toEqual({
      ok: false,
      error: "Ungültiger Phasen-Status.",
    });
  });

  it("rejects a start or due date that is not YYYY-MM-DD", () => {
    expect(resolvePhaseCreate({ name: "X", startDate: "01.09.2026" })).toEqual({
      ok: false,
      error: "Datum muss im Format JJJJ-MM-TT angegeben werden.",
    });
    expect(resolvePhaseCreate({ name: "X", dueDate: "2026-02-31" })).toEqual({
      ok: false,
      error: "Datum muss im Format JJJJ-MM-TT angegeben werden.",
    });
  });
});

describe("resolvePhaseUpdate", () => {
  it("emits only the sent keys", () => {
    expect(resolvePhaseUpdate({ status: "in_arbeit" })).toEqual({
      ok: true,
      set: { status: "in_arbeit" },
    });
  });
  it("clears the dates with null", () => {
    expect(resolvePhaseUpdate({ startDate: null, dueDate: null })).toEqual({
      ok: true,
      set: { startDate: null, dueDate: null },
    });
  });
  it("rejects an empty name", () => {
    expect(resolvePhaseUpdate({ name: " " })).toEqual({ ok: false, error: "Name darf nicht leer sein." });
  });
  it("rejects a bad date on update too", () => {
    expect(resolvePhaseUpdate({ dueDate: "31.10.2026" })).toEqual({
      ok: false,
      error: "Datum muss im Format JJJJ-MM-TT angegeben werden.",
    });
  });
});

describe("applyPhaseOrder", () => {
  it("reorders to exactly the requested sequence", () => {
    expect(applyPhaseOrder(["a", "b", "c"], ["c", "a", "b"])).toEqual(["c", "a", "b"]);
  });
  it("ignores ids that do not belong to the project", () => {
    expect(applyPhaseOrder(["a", "b"], ["b", "zz", "a"])).toEqual(["b", "a"]);
  });
  it("appends phases that the client forgot, keeping their current order", () => {
    expect(applyPhaseOrder(["a", "b", "c", "d"], ["c", "a"])).toEqual(["c", "a", "b", "d"]);
  });
  it("de-duplicates a repeated id", () => {
    expect(applyPhaseOrder(["a", "b"], ["b", "b", "a"])).toEqual(["b", "a"]);
  });
  it("returns the current order for an empty request", () => {
    expect(applyPhaseOrder(["a", "b"], [])).toEqual(["a", "b"]);
  });
});

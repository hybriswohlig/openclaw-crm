import { describe, expect, it } from "vitest";
import {
  resolveMilestoneCreate,
  resolveMilestoneUpdate,
  isMilestoneNewlyReached,
} from "./project-milestones";

describe("isMilestoneNewlyReached", () => {
  it("is true on the transition into erreicht", () => {
    expect(isMilestoneNewlyReached("geplant", "erreicht")).toBe(true);
    expect(isMilestoneNewlyReached("verfehlt", "erreicht")).toBe(true);
  });

  it("is false when it was already erreicht and is updated again", () => {
    expect(isMilestoneNewlyReached("erreicht", "erreicht")).toBe(false);
  });

  it("is false when moving from erreicht back to geplant", () => {
    expect(isMilestoneNewlyReached("erreicht", "geplant")).toBe(false);
  });

  it("is false when leaving erreicht for verfehlt", () => {
    expect(isMilestoneNewlyReached("erreicht", "verfehlt")).toBe(false);
  });

  it("is false for a transition that never touches erreicht", () => {
    expect(isMilestoneNewlyReached("geplant", "verfehlt")).toBe(false);
  });
});

describe("resolveMilestoneCreate", () => {
  it("requires a name", () => {
    expect(resolveMilestoneCreate({ dueDate: "2026-09-01" })).toEqual({
      ok: false,
      error: "Name ist erforderlich.",
    });
  });

  it("defaults status to geplant and leaves the phase link optional", () => {
    const r = resolveMilestoneCreate({ name: " Pilotphase abgeschlossen " });
    expect(r).toEqual({
      ok: true,
      values: { name: "Pilotphase abgeschlossen", dueDate: null, phaseId: null, status: "geplant" },
    });
  });

  it("rejects an unknown status", () => {
    expect(resolveMilestoneCreate({ name: "X", status: "offen" })).toEqual({
      ok: false,
      error: "Ungültiger Meilenstein-Status.",
    });
  });

  it("rejects a due date that is not YYYY-MM-DD", () => {
    // `date` columns are string mode: an unvalidated value goes to Postgres
    // verbatim and either 500s the write or reads back as null.
    for (const bad of ["31.10.2026", "2026-13-45", "morgen"]) {
      expect(resolveMilestoneCreate({ name: "M", dueDate: bad })).toEqual({
        ok: false,
        error: "Datum muss im Format JJJJ-MM-TT angegeben werden.",
      });
    }
  });

  it("keeps a valid due date and phase link", () => {
    const r = resolveMilestoneCreate({
      name: "Go-live",
      dueDate: "2026-10-15",
      phaseId: "ph1",
      status: "geplant",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values.dueDate).toBe("2026-10-15");
    expect(r.values.phaseId).toBe("ph1");
  });
});

describe("resolveMilestoneUpdate", () => {
  const now = new Date("2026-08-21T09:00:00");

  it("stamps reachedAt when the milestone flips to erreicht", () => {
    const r = resolveMilestoneUpdate({ status: "erreicht" }, now);
    expect(r).toEqual({ ok: true, set: { status: "erreicht", reachedAt: now } });
  });

  it("clears reachedAt when it leaves erreicht", () => {
    expect(resolveMilestoneUpdate({ status: "verfehlt" }, now)).toEqual({
      ok: true,
      set: { status: "verfehlt", reachedAt: null },
    });
    expect(resolveMilestoneUpdate({ status: "geplant" }, now)).toEqual({
      ok: true,
      set: { status: "geplant", reachedAt: null },
    });
  });

  it("does not touch reachedAt when the status was not sent", () => {
    expect(resolveMilestoneUpdate({ name: "Neuer Name" }, now)).toEqual({
      ok: true,
      set: { name: "Neuer Name" },
    });
  });

  it("rejects a bad due date on update too", () => {
    expect(resolveMilestoneUpdate({ dueDate: "01.09.2026" }, now)).toEqual({
      ok: false,
      error: "Datum muss im Format JJJJ-MM-TT angegeben werden.",
    });
  });

  it("can unlink the phase and clear the due date", () => {
    expect(resolveMilestoneUpdate({ phaseId: null, dueDate: null }, now)).toEqual({
      ok: true,
      set: { phaseId: null, dueDate: null },
    });
  });

  it("rejects an empty name", () => {
    expect(resolveMilestoneUpdate({ name: "  " }, now)).toEqual({
      ok: false,
      error: "Name darf nicht leer sein.",
    });
  });
});

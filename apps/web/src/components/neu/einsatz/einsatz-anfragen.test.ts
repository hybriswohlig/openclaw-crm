import { describe, expect, it } from "vitest";
import type { EinsatzAnfrage } from "@/lib/einsatz-ansicht";
import { anfragenGruppen } from "./einsatz-logik";

const a = (employeeId: string, answer: EinsatzAnfrage["answer"], answeredAt: string): EinsatzAnfrage => ({ employeeId, name: employeeId, answer, answeredAt });

describe("Anfragen gruppiert", () => {
  it("Ja vor Warteliste, dann Vielleicht; Nein für sich; je Gruppe älteste zuerst", () => {
    const g = anfragenGruppen([
      a("n1", "nein", "2026-11-16T08:00:00Z"),
      a("w1", "warteliste", "2026-11-16T07:00:00Z"),
      a("j2", "ja", "2026-11-16T09:00:00Z"),
      a("v1", "vielleicht", "2026-11-16T06:00:00Z"),
      a("j1", "ja", "2026-11-16T08:30:00Z"),
    ]);
    expect(g.vorn.map((x) => x.employeeId)).toEqual(["j1", "j2", "w1"]);
    expect(g.vielleicht.map((x) => x.employeeId)).toEqual(["v1"]);
    expect(g.nein.map((x) => x.employeeId)).toEqual(["n1"]);
  });

  it("leer bleibt leer", () => {
    expect(anfragenGruppen([])).toEqual({ vorn: [], vielleicht: [], nein: [] });
  });
});

import { describe, expect, it } from "vitest";
import type { GespraechEintrag } from "@/lib/gespraech";
import { nachTagen } from "./verlauf-gruppen";

/** Do 05.11.2026, 10:00 in Berlin. */
const JETZT = new Date("2026-11-05T09:00:00.000Z");

function system(id: string, zeit: string): GespraechEintrag {
  return { art: "system", id, zeit, text: `Zeile ${id}`, betont: null };
}

function nachricht(id: string, zeit: string): GespraechEintrag {
  return {
    art: "nachricht",
    id,
    zeit,
    richtung: "inbound",
    kanal: "whatsapp",
    gespraechId: "g1",
    von: "Familie Weber",
    text: "Hallo",
    status: "received",
    anhaenge: [],
  };
}

describe("nachTagen", () => {
  it("gibt ohne Einträge keine Tage", () => {
    expect(nachTagen([], JETZT)).toEqual([]);
  });

  it("fasst Einträge desselben Berliner Tages zusammen und beschriftet ihn „Mo 02.11.“", () => {
    const a = nachricht("a", "2026-11-02T08:14:00.000Z");
    const b = system("b", "2026-11-02T15:30:00.000Z");
    expect(nachTagen([a, b], JETZT)).toEqual([{ tag: "Mo 02.11.", eintraege: [a, b] }]);
  });

  it("nennt den heutigen Tag „heute“ und den Vortag „gestern“", () => {
    const vorgestern = nachricht("v", "2026-11-03T10:00:00.000Z");
    const gestern = nachricht("g", "2026-11-04T10:00:00.000Z");
    const heute = system("h", "2026-11-05T07:12:00.000Z");
    expect(nachTagen([vorgestern, gestern, heute], JETZT)).toEqual([
      { tag: "Di 03.11.", eintraege: [vorgestern] },
      { tag: "gestern", eintraege: [gestern] },
      { tag: "heute", eintraege: [heute] },
    ]);
  });

  it("rechnet den Tag nach Berlin um, nicht nach UTC", () => {
    // 23:30 UTC am 03.11. ist in Berlin schon der 04.11., also „gestern“.
    const spaet = nachricht("s", "2026-11-03T23:30:00.000Z");
    expect(nachTagen([spaet], JETZT)).toEqual([{ tag: "gestern", eintraege: [spaet] }]);
  });

  it("beginnt einen neuen Tag nur bei einem Tageswechsel in der Reihenfolge", () => {
    const a = nachricht("a", "2026-11-02T08:00:00.000Z");
    const b = nachricht("b", "2026-11-03T08:00:00.000Z");
    const c = nachricht("c", "2026-11-03T09:00:00.000Z");
    const d = system("d", "2026-11-05T08:00:00.000Z");
    const tage = nachTagen([a, b, c, d], JETZT);
    expect(tage.map((t) => t.tag)).toEqual(["Mo 02.11.", "Di 03.11.", "heute"]);
    expect(tage[1]?.eintraege).toEqual([b, c]);
  });

  it("zählt den Jahreswechsel richtig", () => {
    const silvester = nachricht("s", "2026-12-31T12:00:00.000Z");
    const neujahr = nachricht("n", "2027-01-01T12:00:00.000Z");
    const jetzt = new Date("2027-01-01T15:00:00.000Z");
    expect(nachTagen([silvester, neujahr], jetzt).map((t) => t.tag)).toEqual(["gestern", "heute"]);
  });
});

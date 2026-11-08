import { describe, expect, it } from "vitest";
import { buchungChips, type PlanBuchung } from "@/lib/einsatz";
import { ausserhalbText, kmVorschlag, leistenFuerWoche, mieteVorschlag } from "./buchung-logik";

const b = (id: string, von: string, bis: string, o: Partial<PlanBuchung> = {}): PlanBuchung => ({
  id, firmaId: "f", von, bis, text: `Sprinter L · ${von}`, status: "geplant", zugeordnet: 1, geplant: 3, warnungen: [], dealIds: ["d1"], klasseName: "Sprinter L", ...o,
});
const woche1 = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"];
const woche2 = ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"];

describe("Leisten der Buchungen", () => {
  it("Mehrtagesbuchung über eine Wochengrenze: zwei Abschnitte mit Fortsetzung", () => {
    const x = b("x", "2026-11-19", "2026-11-25");
    expect(leistenFuerWoche([x], woche1)).toEqual([{ buchung: x, spalte: 4, breite: 4, bahn: 1, weiterLinks: false, weiterRechts: true }]);
    expect(leistenFuerWoche([x], woche2)).toEqual([{ buchung: x, spalte: 1, breite: 3, bahn: 1, weiterLinks: true, weiterRechts: false }]);
  });

  it("überlappende Buchungen auf zwei Bahnen, nicht überlappende teilen sich eine", () => {
    const l = leistenFuerWoche([b("a", "2026-11-16", "2026-11-18"), b("b", "2026-11-17", "2026-11-17"), b("c", "2026-11-20", "2026-11-20")], woche1);
    expect(l.map((x) => [x.buchung.id, x.spalte, x.breite, x.bahn])).toEqual([
      ["a", 1, 3, 1],
      ["b", 2, 1, 2],
      ["c", 5, 1, 1],
    ]);
  });

  it("Buchung außerhalb der Woche erscheint nicht", () => {
    expect(leistenFuerWoche([b("a", "2026-12-01", "2026-12-02")], woche1)).toEqual([]);
  });

  it("Verschieben aus der Buchung: Rückfragesatz; innerhalb oder ohne Zuordnung keiner", () => {
    const l = [b("a", "2026-11-17", "2026-11-23", { text: "Sprinter L · Sixt · Di 17. bis Mo 23.11." })];
    expect(ausserhalbText(l, "d1", "2026-11-24")).toBe("Der Termin liegt dann außerhalb der Buchung Sprinter L · Sixt · Di 17. bis Mo 23.11.");
    expect(ausserhalbText(l, "d1", "2026-11-20")).toBeNull();
    expect(ausserhalbText(l, "d2", "2026-11-24")).toBeNull();
    expect(ausserhalbText([{ ...l[0]!, status: "storniert" }], "d1", "2026-11-24")).toBeNull();
  });

  it("Vorschlag Miete und Kilometer aus den Klassenwerten", () => {
    const k = { mietpreisWochentage: { mo: 60, di: 60, mi: 60, do: 60, fr: 170, sa: 210, so: 60 }, inklusivKmProTag: 100 };
    expect(mieteVorschlag(k, "2026-11-20", "2026-11-22")).toBe(44000);
    expect(kmVorschlag(k, "2026-11-20", "2026-11-22")).toBe(300);
    expect(mieteVorschlag({ mietpreisWochentage: null }, "2026-11-20", "2026-11-22")).toBeNull();
  });
});

describe("buchungChips (Im Blick)", () => {
  it("nur solange zugeordnet < geplant, nicht vorbei, nicht storniert", () => {
    const chips = buchungChips(
      [
        b("offen", "2026-11-17", "2026-11-23"),
        b("voll", "2026-11-17", "2026-11-23", { zugeordnet: 3 }),
        b("vorbei", "2026-11-01", "2026-11-05"),
        b("storno", "2026-11-17", "2026-11-23", { status: "storniert" }),
      ],
      "2026-11-18",
    );
    expect(chips).toEqual([{ id: "offen", tag: "2026-11-18", fett: "Sprinter L", text: "Di 17. bis Mo 23.11.: 1 von 3 Aufträgen" }]);
  });
});

describe("imBlickAus mit Buchungen", () => {
  it("Chip art buchung mit Klasse fett, springt auf den Beginn (oder heute)", async () => {
    const { imBlickAus } = await import("@/lib/plan-heute");
    const chips = imBlickAus([], "2026-11-18", 4, [b("x", "2026-11-17", "2026-11-23")]);
    expect(chips).toEqual([{ key: "buchung:x", art: "buchung", ton: "gold", fett: "Sprinter L", text: "Di 17. bis Mo 23.11.: 1 von 3 Aufträgen", tag: "2026-11-18" }]);
    expect(imBlickAus([], "2026-11-18")).toEqual([]);
  });
});

describe("Review M4: leere inklusive km = Kilometer der Klasse", () => {
  it("Speichern trägt den Klassenwert ein, Leiste nennt die offene Grenze", async () => {
    const { inklusivKmZumSpeichern } = await import("./buchung-logik");
    const { buchungsLeisteText } = await import("@/lib/einsatz");
    expect(inklusivKmZumSpeichern(null, { inklusivKmProTag: 100 }, "2026-11-20", "2026-11-22")).toBe(300);
    expect(inklusivKmZumSpeichern(500, { inklusivKmProTag: 100 }, "2026-11-20", "2026-11-22")).toBe(500);
    expect(inklusivKmZumSpeichern(null, null, "2026-11-20", "2026-11-22")).toBeNull();
    const b0 = {
      id: "b", firmaId: "f", von: "2026-11-16", bis: "2026-11-16", stationId: "s", stationName: "Sixt", stationAnbieter: null,
      klasseId: "k", klasseName: "Sprinter L", mieteCent: 45000, inklusivKm: null, mehrkmSatzCent: null, geplanteAuftraege: 2,
      status: "geplant" as const, notiz: null,
    };
    expect(buchungsLeisteText(b0, [])).toContain("km wie Klasse");
  });
});

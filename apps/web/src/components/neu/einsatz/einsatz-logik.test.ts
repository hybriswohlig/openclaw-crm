import { describe, expect, it } from "vitest";
import { einsatzKosten, lohnVergleich, planMinutenJePerson, type EinsatzPerson } from "@/lib/einsatz";
import type { EinsatzAnsicht, EinsatzPersonLage } from "@/lib/einsatz-ansicht";
import {
  auswahlEntfernen,
  auswahlHinzufuegen,
  geaendert,
  leitungSetzen,
  minutenSetzen,
  rueckfrageFuer,
  startAuswahl,
  summeAus,
  teamBody,
  vorschlagUebernehmen,
} from "./einsatz-logik";

const person = (id: string, name: string, o: Partial<EinsatzPersonLage> = {}): EinsatzPersonLage => ({
  id, name, kuerzel: name.slice(0, 2).toUpperCase(), aktiv: true, plz: "70176", wohnort: "Stuttgart", kannSprinter: false,
  eigenerPkw: false, satzFahrtCent: 1500, satzArbeitCent: 2000, lage: "frei", belegtMit: [], abwesend: null, stempeltGerade: false, ...o,
});

// Rechner: 3 Personen, Arbeit 900 + Fahrer 60 Personenminuten, Fahrt 60 min je Person, Puffer 10 %.
const ps = { arbeitPm: 900, fahrerPm: 60, fahrzeitPm: 180, pufferProzent: 10 };
const kalkArbeit = ((900 + 60) / 60) * 1.1 * 20;
const kalkFahrt = ((60 * 3) / 60) * 1.1 * 15;
const rechner: NonNullable<EinsatzAnsicht["rechner"]> = {
  groesse: 3, auftragsart: "umzug", fahrtMin: 60, personenH: 20.24, personalStunden: ps,
  posten: [{ key: "personal.arbeit", betrag: kalkArbeit }, { key: "personal.fahrt", betrag: kalkFahrt }],
  festpreisEur: 1290, selbstkostenEur: 813, fahrzeugName: "Sprinter L", fahrzeugEur: 120, station: "Sixt", empfehlung: null,
};
const personen = [person("a", "Anna Berg", { kannSprinter: true }), person("b", "Ben Cho"), person("c", "Cem Dal"), person("d", "Dora Eck", { lage: "belegt", belegtMit: [{ dealId: "x", titel: "Nowak" }] })];
const ansicht = {
  team: [] as EinsatzAnsicht["team"],
  teamVorschlag: {
    team: ["a", "b", "c"].map((id, i) => ({ employeeId: id, role: (i === 0 ? "lead" : "helper") as "lead" | "helper", plannedDriveMinutes: 66, plannedWorkMinutes: 352 })),
    fehlen: 0, hinweise: [],
  },
  rechner, personen, anfahrten: [],
};

describe("Einsatz-Auswahl", () => {
  it("Vorschlag vorbelegt, gleiche Sätze ergeben genau die Kalkulation", () => {
    const s = startAuswahl(ansicht);
    expect(s.team.map((t) => [t.employeeId, t.role])).toEqual([["a", "lead"], ["b", "helper"], ["c", "helper"]]);
    const m = planMinutenJePerson({ teamgroesse: 3, fahrtMin: 60, personenH: null, personalStunden: ps });
    expect(s.team.every((t) => t.fahrtMin === m.fahrtMin && t.arbeitMin === m.arbeitMin)).toBe(true);
    const { vergleich } = summeAus(s, ansicht);
    expect(vergleich.text).toBe("wie Kalkulation, Marge 37 %");
  });

  it("Hinzufügen und Entfernen ändern die Arbeitsminuten je Person, Fahrt bleibt", () => {
    const s3 = startAuswahl(ansicht);
    const s4 = auswahlHinzufuegen(s3, "d", rechner, { trotzdem: true });
    const m4 = planMinutenJePerson({ teamgroesse: 4, fahrtMin: 60, personenH: null, personalStunden: ps });
    expect(s4.team).toHaveLength(4);
    expect(s4.team.every((t) => t.arbeitMin === m4.arbeitMin && t.fahrtMin === m4.fahrtMin)).toBe(true);
    expect(s4.bestaetigtAmTag).toEqual(["d"]);
    const s2 = auswahlEntfernen(auswahlEntfernen(s4, "d", rechner), "a", rechner);
    expect(s2.team.map((t) => t.employeeId)).toEqual(["b", "c"]);
    expect(s2.team[0]!.role).toBe("lead");
    expect(s2.bestaetigtAmTag).toEqual([]);
    expect(s2.team[0]!.arbeitMin).toBe(planMinutenJePerson({ teamgroesse: 2, fahrtMin: 60, personenH: null, personalStunden: ps }).arbeitMin);
  });

  it("von Hand geänderte Minuten bleiben bei Teamänderung; zurück verteilt neu", () => {
    let s = minutenSetzen(startAuswahl(ansicht), "b", "arbeit", 200, rechner);
    s = auswahlEntfernen(s, "c", rechner);
    expect(s.team.find((t) => t.employeeId === "b")!.arbeitMin).toBe(200);
    expect(s.team.find((t) => t.employeeId === "a")!.arbeitMin).toBe(planMinutenJePerson({ teamgroesse: 2, fahrtMin: 60, personenH: null, personalStunden: ps }).arbeitMin);
    s = minutenSetzen(s, "b", "arbeit", null, rechner);
    expect(s.team.find((t) => t.employeeId === "b")!.vonHand.arbeit).toBe(false);
  });

  it("Summe gleich lohnVergleich aus dem Vertrag", () => {
    const s = auswahlHinzufuegen(startAuswahl(ansicht), "d", rechner, { trotzdem: true });
    const team = s.team.map((t) => ({ person: personen.find((p) => p.id === t.employeeId)! as EinsatzPerson, fahrtMin: t.fahrtMin, arbeitMin: t.arbeitMin }));
    const kosten = einsatzKosten({ team, fahrzeugEur: 120, fahrzeugName: "Sprinter L", anfahrten: [] });
    expect(summeAus(s, ansicht)).toEqual({ kosten, vergleich: lohnVergleich({ kosten, posten: rechner.posten, festpreisEur: 1290, selbstkostenEur: 813 }) });
  });

  it("Leitung, Body und Änderungserkennung", () => {
    const s = leitungSetzen(startAuswahl(ansicht), "c");
    expect(s.team.filter((t) => t.role === "lead").map((t) => t.employeeId)).toEqual(["c"]);
    const body = teamBody(auswahlHinzufuegen(s, "d", rechner, { trotzdem: true }));
    expect(body.bestaetigtAmTag).toEqual(["d"]);
    expect(body.team.every((t) => Number.isInteger(t.plannedWorkMinutes))).toBe(true);
    expect(teamBody(s).bestaetigtAmTag).toBeUndefined();
    const gespeichert = { team: s.team.map((t, i) => ({ id: `z${i}`, employeeId: t.employeeId, role: t.role, plannedDriveMinutes: t.fahrtMin, plannedWorkMinutes: t.arbeitMin, confirmedAt: null })) };
    expect(geaendert(s, gespeichert)).toBe(false);
    expect(geaendert(minutenSetzen(s, "a", "fahrt", 10, rechner), gespeichert)).toBe(true);
    // Gespeichertes Team mit eigenen Minuten startet mit genau diesen Minuten.
    expect(startAuswahl({ ...ansicht, team: gespeichert.team }).team.map((t) => t.arbeitMin)).toEqual(s.team.map((t) => t.arbeitMin));
  });

  it("Rückfragen für belegt und abwesend, nicht für frei oder schon bestätigt", () => {
    const s = vorschlagUebernehmen(ansicht);
    expect(rueckfrageFuer(personen[3]!, "Sa 21.11.", s)?.text).toBe("Dora Eck ist am Sa 21.11. schon bei Nowak eingeteilt. Trotzdem einteilen?");
    const lena = person("l", "Lena Fischer", { lage: "abwesend", abwesend: "urlaub" });
    expect(rueckfrageFuer(lena, "Sa 21.11.", s)?.text).toBe("Lena Fischer hat am Sa 21.11. Urlaub. Trotzdem einteilen?");
    expect(rueckfrageFuer(personen[1]!, "Sa 21.11.", s)).toBeNull();
    expect(rueckfrageFuer(lena, "Sa 21.11.", { ...s, bestaetigtAmTag: ["l"] })).toBeNull();
  });
});

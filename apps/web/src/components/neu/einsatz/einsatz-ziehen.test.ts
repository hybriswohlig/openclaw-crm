import { describe, expect, it } from "vitest";
import { pinGruppen } from "@/lib/einsatz";
import {
  ansichtLesen,
  ansichtMerken,
  minutenBehalten,
  FILTER_VORGABE,
  gruppenLage,
  kartenPersonenFiltern,
  kurzName,
  laengsteAnfahrt,
  pinText,
  umkreisLesen,
  umkreisMerken,
  verlaufMerken,
  verlaufZurueck,
  versteckteAbwesende,
  VERLAUF_LEER,
  VERLAUF_MAX,
} from "./einsatz-karte-logik";
import { FIXTURE_ANSICHT, FIXTURE_KARTE, FIXTURE_PERSONEN } from "./einsatz-karte.fixture";
import { auswahlHinzufuegen, minutenSetzen, startAuswahl, summeAus, teamBody, type Auswahl } from "./einsatz-logik";
import { ablegen, abstandText, kompaktText, trefferZiel, ziehenVorschau, ABLAGE_RADIUS_PX } from "./einsatz-ziehen";

const a = FIXTURE_ANSICHT;
const p = (id: string) => FIXTURE_PERSONEN.find((x) => x.id === id)!;
const leer: Auswahl = { team: [], bestaetigtAmTag: [] };

describe("trefferZiel", () => {
  const auftrag = { x: 100, y: 100 };
  const team = { left: 500, top: 20, right: 700, bottom: 80 };

  it("Rand des Kreises zählt, knapp außerhalb nicht", () => {
    expect(trefferZiel({ x: 100 + ABLAGE_RADIUS_PX, y: 100 }, { auftrag, team: [] })).toBe("auftrag");
    expect(trefferZiel({ x: 100, y: 100 - ABLAGE_RADIUS_PX }, { auftrag, team: [] })).toBe("auftrag");
    expect(trefferZiel({ x: 100 + 33, y: 100 + 33 }, { auftrag, team: [] })).toBe("auftrag");
    expect(trefferZiel({ x: 100 + ABLAGE_RADIUS_PX + 0.5, y: 100 }, { auftrag, team: [] })).toBeNull();
    expect(trefferZiel({ x: 100 + 35, y: 100 + 35 }, { auftrag, team: [] })).toBeNull();
  });

  it("Team-Liste als Ziel, auch die zweite Fläche (Handy-Leiste)", () => {
    expect(trefferZiel({ x: 600, y: 50 }, { auftrag, team: [team] })).toBe("team");
    expect(trefferZiel({ x: 700, y: 80 }, { auftrag: null, team: [null, team] })).toBe("team");
    expect(trefferZiel({ x: 701, y: 80 }, { auftrag: null, team: [team] })).toBeNull();
  });

  it("ohne Auftragspunkt und ohne Team nichts", () => {
    expect(trefferZiel({ x: 0, y: 0 }, { auftrag: null, team: [] })).toBeNull();
  });
});

describe("ablegen", () => {
  it("frei sofort hinzufügen", () => {
    const r = ablegen(p("ma_dr"), leer, a.rechner, "Fr 20.11.");
    expect(r.art).toBe("hinzufuegen");
    if (r.art === "hinzufuegen") expect(r.auswahl.team.map((t) => [t.employeeId, t.role])).toEqual([["ma_dr", "lead"]]);
  });

  it("belegt: Rückfrage mit Name, Tag und Titel", () => {
    const r = ablegen(p("ma_jb"), leer, a.rechner, "Fr 20.11.");
    expect(r).toMatchObject({
      art: "rueckfrage",
      rueckfrage: { art: "belegt", text: "Jonas Brandt ist am Fr 20.11. schon bei Umzug Nowak eingeteilt. Trotzdem einteilen?" },
    });
  });

  it("abwesend: Rückfrage mit Art", () => {
    const r = ablegen(p("ma_lf"), leer, a.rechner, "Fr 20.11.");
    expect(r).toMatchObject({ art: "rueckfrage", rueckfrage: { art: "abwesend", text: "Lena Fischer hat am Fr 20.11. Urlaub. Trotzdem einteilen?" } });
    const krank = ablegen({ ...p("ma_lf"), abwesend: "krank" }, leer, a.rechner, "Fr 20.11.");
    expect(krank).toMatchObject({ rueckfrage: { text: "Lena Fischer ist am Fr 20.11. krank gemeldet. Trotzdem einteilen?" } });
    const gesperrt = ablegen({ ...p("ma_lf"), abwesend: "gesperrt" }, leer, a.rechner, "Fr 20.11.");
    expect(gesperrt).toMatchObject({ rueckfrage: { text: "Lena Fischer ist am Fr 20.11. gesperrt. Trotzdem einteilen?" } });
  });

  it("schon im Team: nur Hinweis, Auswahl bleibt", () => {
    const s = auswahlHinzufuegen(leer, "ma_dr", a.rechner);
    expect(ablegen(p("ma_dr"), s, a.rechner, "Fr 20.11.")).toEqual({ art: "schon_im_team", text: "Deniz Roth ist schon im Team." });
  });

  it("Person aus einem Bündel: alle drei am selben Ort einzeln ablegbar", () => {
    const { gruppen } = pinGruppen(FIXTURE_KARTE.personen);
    const buendel = gruppen.find((g) => g.schluessel === "70372 stuttgart")!;
    expect(buendel.personen).toHaveLength(3);
    let s = leer;
    for (const kp of buendel.personen) {
      const r = ablegen(p(kp.employeeId), s, a.rechner, "Fr 20.11.");
      expect(r.art).toBe("hinzufuegen");
      if (r.art === "hinzufuegen") s = r.auswahl;
    }
    expect(s.team.map((t) => t.employeeId).sort()).toEqual(["ma_ak", "ma_dr", "ma_mk"]);
  });
});

describe("ziehenVorschau", () => {
  it("zeigt neue Summe und Abstand vor dem Loslassen, gleich wie die Summenleiste danach", () => {
    const s = startAuswahl(a);
    const v = ziehenVorschau(p("ma_dr"), s, a);
    const danach = summeAus(auswahlHinzufuegen(s, "ma_dr", a.rechner), a).vergleich;
    expect(v.summeCent).toBe(danach.summeCent);
    expect(v.abstandCent).toBe(danach.differenzCent);
    expect(v.text).toBe(kompaktText(3, danach.summeCent, danach.differenzCent));
    expect(v.text.startsWith("3 im Team · ")).toBe(true);
    expect(v.rueckfrage).toBeNull();
  });

  it("markiert die Rückfrage für belegt und abwesend, nicht nach bejahter Rückfrage", () => {
    expect(ziehenVorschau(p("ma_jb"), leer, a).rueckfrage).toBe("belegt");
    expect(ziehenVorschau(p("ma_lf"), leer, a).rueckfrage).toBe("abwesend");
    expect(ziehenVorschau(p("ma_lf"), { team: [], bestaetigtAmTag: ["ma_lf"] }, a).rueckfrage).toBeNull();
  });

  it("schon im Team: heutige Summe", () => {
    const s = auswahlHinzufuegen(leer, "ma_dr", a.rechner);
    const v = ziehenVorschau(p("ma_dr"), s, a);
    expect(v.schonImTeam).toBe(true);
    expect(v.summeCent).toBe(summeAus(s, a).vergleich.summeCent);
  });

  it("Texte ohne Gedankenstrich", () => {
    expect(abstandText(2800)).toBe("+28 €");
    expect(abstandText(-1240)).toBe("−12 €");
    expect(abstandText(20)).toBe("±0 €");
    expect(kompaktText(3, 61240, 2800)).toBe("3 im Team · 612 € · +28 € zur Kalkulation");
    expect(kompaktText(1, 1234500, null)).toBe("1 im Team · 12.345 €");
    expect(kompaktText(3, 61240, 2800)).not.toMatch(/[—–]/);
  });
});

describe("Umschalten behält Auswahl und von Hand geänderte Minuten", () => {
  it("die Auswahl lebt im Dialog; Karte und Liste schicken dieselbe Nutzlast", () => {
    let s = startAuswahl(a);
    s = minutenSetzen(s, "ma_ak", "arbeit", 300, a.rechner);
    const vorher = teamBody(s);
    // Umschalten Liste → Karte → Liste ändert den Zustand nicht (gleiche Referenz im Dialog).
    ansichtMerken("karte", speicher());
    expect(teamBody(s)).toEqual(vorher);
    expect(s.team.find((t) => t.employeeId === "ma_ak")).toMatchObject({ arbeitMin: 300, vonHand: { arbeit: true } });
    // Hinzufügen über die Karte verteilt nur die nicht von Hand gesetzten Minuten neu.
    const r = ablegen(p("ma_dr"), s, a.rechner, "Fr 20.11.");
    expect(r.art).toBe("hinzufuegen");
    if (r.art === "hinzufuegen") expect(r.auswahl.team.find((t) => t.employeeId === "ma_ak")!.arbeitMin).toBe(300);
  });
});

function speicher(start: Record<string, string> = {}) {
  const m = new Map(Object.entries(start));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe("gemerkte Wahl je Browser", () => {
  it("Ansicht Vorgabe Liste, merkt Karte", () => {
    const s = speicher();
    expect(ansichtLesen(s)).toBe("liste");
    ansichtMerken("karte", s);
    expect(ansichtLesen(s)).toBe("karte");
    expect(ansichtLesen(null)).toBe("liste");
  });

  it("Umkreis Vorgabe 30, aus = 0, Unsinn = Vorgabe", () => {
    const s = speicher();
    expect(umkreisLesen(s)).toBe(30);
    umkreisMerken(0, s);
    expect(umkreisLesen(s)).toBe(0);
    umkreisMerken(50, s);
    expect(umkreisLesen(s)).toBe(50);
    expect(umkreisLesen(speicher({ "neu.einsatz.umkreis": "42" }))).toBe(30);
  });

  it("gesperrter Speicher wirft nicht", () => {
    const boese = {
      getItem: () => {
        throw new Error("gesperrt");
      },
      setItem: () => {
        throw new Error("gesperrt");
      },
    };
    expect(ansichtLesen(boese)).toBe("liste");
    expect(umkreisLesen(boese)).toBe(30);
    expect(() => ansichtMerken("karte", boese)).not.toThrow();
    expect(() => umkreisMerken(15, boese)).not.toThrow();
  });
});

describe("Filter über der Karte", () => {
  const details = new Map(FIXTURE_PERSONEN.map((x) => [x.id, x]));
  const ids = (l: { employeeId: string }[]) => l.map((x) => x.employeeId).sort();

  it("Abwesende standardmäßig aus, mit „alle zeigen“ da", () => {
    expect(ids(kartenPersonenFiltern(FIXTURE_KARTE.personen, FILTER_VORGABE, details, []))).not.toContain("ma_lf");
    expect(ids(kartenPersonenFiltern(FIXTURE_KARTE.personen, { ...FILTER_VORGABE, alle: true }, details, []))).toContain("ma_lf");
    expect(versteckteAbwesende(FIXTURE_KARTE.personen, [])).toBe(1);
    expect(versteckteAbwesende(FIXTURE_KARTE.personen, ["ma_lf"])).toBe(0);
  });

  it("Nur frei, Sprinter, Eigener PKW", () => {
    expect(ids(kartenPersonenFiltern(FIXTURE_KARTE.personen, { ...FILTER_VORGABE, nurFrei: true }, details, []))).not.toContain("ma_jb");
    expect(ids(kartenPersonenFiltern(FIXTURE_KARTE.personen, { ...FILTER_VORGABE, sprinter: true }, details, []))).toEqual(["ma_jb", "ma_mk"]);
    expect(ids(kartenPersonenFiltern(FIXTURE_KARTE.personen, { ...FILTER_VORGABE, pkw: true }, details, []))).not.toContain("ma_ak");
  });

  it("Team-Mitglieder bleiben immer sichtbar", () => {
    const f = { nurFrei: true, sprinter: true, pkw: true, alle: false };
    expect(ids(kartenPersonenFiltern(FIXTURE_KARTE.personen, f, details, ["ma_lf", "ma_ak"]))).toEqual(["ma_ak", "ma_lf", "ma_mk"]);
  });
});

describe("Pins", () => {
  it("Kürzel plus kürzeste Anfahrt, Bündel mit +N", () => {
    const { gruppen } = pinGruppen(FIXTURE_KARTE.personen);
    const buendel = gruppen.find((g) => g.schluessel === "70372 stuttgart")!;
    expect(pinText(buendel, a.anfahrten)).toEqual({ kuerzel: ["AK", "DR", "MK"], mehr: 0, minuten: 18, text: "AK DR MK · 18 min" });
    const vier = { personen: [...buendel.personen, { ...buendel.personen[0]!, employeeId: "z", kuerzel: "ZZ" }] };
    expect(pinText(vier, a.anfahrten).text).toBe("AK DR MK +1 · 18 min");
    expect(pinText({ personen: [buendel.personen[0]!] }, []).text).toBe("AK");
  });

  it("Lage der Gruppe: Team vor frei vor belegt", () => {
    const { gruppen } = pinGruppen(FIXTURE_KARTE.personen);
    const bb = gruppen.find((g) => g.schluessel === "71032 böblingen")!;
    expect(gruppenLage(bb, [])).toBe("belegt");
    expect(gruppenLage(bb, ["ma_jb"])).toBe("team");
  });

  it("jede Person genau einmal in Gruppen oder ohne Punkt", () => {
    const { gruppen, ohnePunkt } = pinGruppen(FIXTURE_KARTE.personen);
    const alle = [...gruppen.flatMap((g) => g.personen), ...ohnePunkt].map((x) => x.employeeId).sort();
    expect(alle).toEqual(FIXTURE_KARTE.personen.map((x) => x.employeeId).sort());
    expect(ohnePunkt.map((x) => x.employeeId)).toEqual(["ma_po", "ma_xy"]);
  });
});

describe("Teamkarte", () => {
  const namen = Object.fromEntries(FIXTURE_PERSONEN.map((x) => [x.id, x.name]));
  it("Längste Anfahrt mit Kurzname", () => {
    expect(laengsteAnfahrt(["ma_mk", "ma_ts", "ma_ak"], a.anfahrten, namen)).toBe("Längste Anfahrt: 31 min, T. Schmid");
    expect(laengsteAnfahrt(["ma_po"], a.anfahrten, namen)).toBeNull();
    expect(laengsteAnfahrt([], a.anfahrten, namen)).toBeNull();
    expect(kurzName("Anna Keller")).toBe("A. Keller");
    expect(kurzName("Anna Maria von Keller")).toBe("A. Keller");
    expect(kurzName("Cher")).toBe("Cher");
  });
});

describe("Rückgängig", () => {
  it("merkt je Änderung, geht zurück bis leer", () => {
    const s0 = leer;
    const s1 = auswahlHinzufuegen(s0, "ma_dr", a.rechner);
    const s2 = auswahlHinzufuegen(s1, "ma_ak", a.rechner);
    let v = verlaufMerken(VERLAUF_LEER, s0, s1);
    v = verlaufMerken(v, s1, s2);
    v = verlaufMerken(v, s2, s2);
    expect(v.vorher).toHaveLength(2);
    const z1 = verlaufZurueck(v)!;
    expect(z1[1]).toBe(s1);
    const z2 = verlaufZurueck(z1[0])!;
    expect(z2[1]).toBe(s0);
    expect(verlaufZurueck(z2[0])).toBeNull();
  });

  it("Rückgängig nimmt nur das Team zurück, getippte Minuten der Verbleibenden bleiben", () => {
    const s0 = startAuswahl(a);
    const s1 = auswahlHinzufuegen(s0, "ma_dr", a.rechner);
    const getippt = minutenSetzen(s1, "ma_ak", "arbeit", 300, a.rechner);
    const zurueck = minutenBehalten(s0, getippt);
    expect(zurueck.team.map((t) => t.employeeId)).toEqual(s0.team.map((t) => t.employeeId));
    expect(zurueck.team.find((t) => t.employeeId === "ma_ak")).toMatchObject({ arbeitMin: 300, vonHand: { arbeit: true } });
    expect(zurueck.team.find((t) => t.employeeId === "ma_mk")!.arbeitMin).toBe(s0.team.find((t) => t.employeeId === "ma_mk")!.arbeitMin);
  });

  it("höchstens VERLAUF_MAX Schritte", () => {
    let v = VERLAUF_LEER;
    for (let i = 0; i < VERLAUF_MAX + 5; i++) v = verlaufMerken(v, { team: [], bestaetigtAmTag: [String(i)] }, leer);
    expect(v.vorher).toHaveLength(VERLAUF_MAX);
    expect(v.vorher[0]!.bestaetigtAmTag).toEqual(["5"]);
  });
});

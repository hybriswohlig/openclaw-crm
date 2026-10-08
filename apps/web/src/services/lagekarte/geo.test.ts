import { describe, expect, it } from "vitest";
import { findeOrtsname, findePlzImText, loeseOrte, plzEintrag, versatz } from "./geo";

describe("plzEintrag", () => {
  it("liefert Stuttgart-West für 70176", () => {
    const e = plzEintrag("70176");
    expect(e?.ags).toBe("08111");
    expect(e?.lat).toBeCloseTo(48.7718, 3);
  });
  it("lehnt Unsinn ab", () => {
    expect(plzEintrag("7017")).toBeNull();
    expect(plzEintrag("abcde")).toBeNull();
    expect(plzEintrag(null)).toBeNull();
    expect(plzEintrag("99999")).toBeNull();
  });
  it("trimmt Leerzeichen", () => {
    expect(plzEintrag(" 70176 ")?.name).toBe("Stuttgart-West");
  });
});

describe("findePlzImText", () => {
  it("findet PLZ im Freitext", () => {
    expect(findePlzImText("Hauptstraße 5, 72218 Wildberg")).toBe("72218");
  });
  it("ignoriert Hausnummern und unbekannte Zahlen", () => {
    // 99999 steht nicht in der Tabelle (12345 wäre eine Berliner PLZ)
    expect(findePlzImText("Im Gewerbepark 99999")).toBeNull();
    expect(findePlzImText("Hausnr 12")).toBeNull();
    expect(findePlzImText(null)).toBeNull();
  });
  it("bevorzugt bei mehreren Treffern eine baden-württembergische PLZ", () => {
    // 10115 Berlin steht vor 72218 Wildberg im Text
    expect(findePlzImText("Büro 10115 Berlin, Lager 72218 Wildberg")).toBe("72218");
    expect(findePlzImText("Lager 72218 Wildberg, Büro 10115 Berlin")).toBe("72218");
  });
  it("nimmt ohne BW-Treffer den ersten bekannten", () => {
    expect(findePlzImText("10115 Berlin und 01053 Dresden")).toBe("10115");
  });
});

describe("findeOrtsname", () => {
  it("findet eindeutige BW-Orte, auch mit Umlaut-Varianten", () => {
    expect(findeOrtsname("Sindelfingen")?.ags).toBe("08115");
    expect(findeOrtsname("Boeblingen")?.ags).toBe("08115");
    expect(findeOrtsname("Böblingen")?.ags).toBe("08115");
  });
  it("findet auch zerlegte Umlaute (NFD, z. B. aus macOS-Eingaben) (M-13)", () => {
    const zerlegt = "Bo\u0308blingen";
    expect(zerlegt).not.toBe("Böblingen");
    expect(findeOrtsname(zerlegt)?.ags).toBe("08115");
    expect(findeOrtsname("Tu\u0308bingen")?.name).toBe("Tübingen");
  });
  it("liefert den Ortsnamen in Originalschreibweise", () => {
    expect(findeOrtsname("boeblingen")?.name).toBe("Böblingen");
  });
  it("findet Stadtteile über den Stadtnamen", () => {
    expect(findeOrtsname("Stuttgart-Bad Cannstatt")?.ags).toBe("08111");
    expect(findeOrtsname("Stuttgart")?.ags).toBe("08111");
  });
  it("findet den Ort am Ende eines Teilstücks oder Texts", () => {
    expect(findeOrtsname("Marktstraße 8, Nagold")?.ags).toBe("08235");
    expect(findeOrtsname("72202 Nagold")?.ags).toBe("08235");
  });
  it("mittelt die Koordinaten über alle Treffer eines Ortes", () => {
    const stuttgart = findeOrtsname("Stuttgart");
    expect(stuttgart?.lat).toBeGreaterThan(48.7);
    expect(stuttgart?.lat).toBeLessThan(48.85);
  });
  it("lehnt mehrdeutige Namen ab", () => {
    // Neuhausen gibt es in mehreren BW-Kreisen
    expect(findeOrtsname("Neuhausen")).toBeNull();
  });
  it("ignoriert Orte außerhalb von Baden-Württemberg", () => {
    expect(findeOrtsname("Dresden")).toBeNull();
  });
  it("ignoriert leere Eingaben", () => {
    expect(findeOrtsname("")).toBeNull();
    expect(findeOrtsname("   ,  ")).toBeNull();
    expect(findeOrtsname(undefined)).toBeNull();
  });
});

describe("versatz", () => {
  it("ist deterministisch und höchstens 250 m", () => {
    const a = versatz("lead-1", 48.77, 9.17);
    expect(versatz("lead-1", 48.77, 9.17)).toEqual(a);
    const dLatM = (a.lat - 48.77) * 111320;
    const dLngM = (a.lng - 9.17) * 111320 * Math.cos((48.77 * Math.PI) / 180);
    const m = Math.hypot(dLatM, dLngM);
    expect(m).toBeGreaterThanOrEqual(35);
    expect(m).toBeLessThanOrEqual(255);
  });
  it("streut verschiedene Leads auseinander und rundet auf 5 Nachkommastellen", () => {
    const a = versatz("lead-1", 48.77, 9.17);
    const b = versatz("lead-2", 48.77, 9.17);
    expect(a).not.toEqual(b);
    expect(Math.round(a.lat * 1e5) / 1e5).toBe(a.lat);
    expect(Math.round(a.lng * 1e5) / 1e5).toBe(a.lng);
  });
});

describe("loeseOrte", () => {
  it("nimmt die PLZ der Abholadresse zuerst", () => {
    const r = loeseOrte({ leadId: "x", abholung: { postcode: "71034", city: "Böblingen" }, immoscoutVon: { zip: "70176" }, ziel: null, immoscoutNach: null });
    expect(r.ort?.plz).toBe("71034");
    expect(r.ort?.quelle).toBe("abholadresse");
    expect(r.ort?.genauigkeit).toBe("plz");
    expect(r.ort?.kreisAgs).toBe("08115");
    expect(r.ort?.ortsname).toBe("Böblingen");
  });
  it("setzt die Position als Versatz des Tabellenpunkts, das Ziel mit eigenem Versatz", () => {
    const r = loeseOrte({ leadId: "x", abholung: { postcode: "71034" }, immoscoutVon: null, ziel: { postcode: "71034" }, immoscoutNach: null });
    const e = plzEintrag("71034")!;
    expect(r.ort).toMatchObject(versatz("x", e.lat, e.lng));
    expect(r.ziel).toMatchObject(versatz("x:ziel", e.lat, e.lng));
  });
  it("nimmt bei ImmoScout from.zip (nie client.zip)", () => {
    const r = loeseOrte({ leadId: "x", abholung: null, immoscoutVon: { zip: "72070", city: "Tübingen" }, ziel: null, immoscoutNach: null });
    expect(r.ort?.plz).toBe("72070");
    expect(r.ort?.quelle).toBe("immoscout");
  });
  it("fällt auf Freitext, dann Ortsname zurück", () => {
    expect(loeseOrte({ leadId: "x", abholung: { line1: "Marktstr. 8, 72218 Wildberg" }, immoscoutVon: null, ziel: null, immoscoutNach: null }).ort?.quelle).toBe("freitext");
    const o = loeseOrte({ leadId: "x", abholung: { line1: "Bahnhofstraße 3", city: "Nagold" }, immoscoutVon: null, ziel: null, immoscoutNach: null }).ort;
    expect(o?.quelle).toBe("ortsname");
    expect(o?.genauigkeit).toBe("ort");
    expect(o?.plz).toBeNull();
    expect(o?.kreisAgs).toBe("08235");
    expect(o?.ortsname).toBe("Nagold");
  });
  it("nutzt den Ortsnamen aus ImmoScout, wenn sonst nichts passt", () => {
    const o = loeseOrte({ leadId: "x", abholung: null, immoscoutVon: { city: "Sindelfingen" }, ziel: null, immoscoutNach: null }).ort;
    expect(o?.quelle).toBe("ortsname");
    expect(o?.kreisAgs).toBe("08115");
  });
  it("überspringt eine unbekannte Abhol-PLZ", () => {
    const r = loeseOrte({ leadId: "x", abholung: { postcode: "99999", city: "Nagold" }, immoscoutVon: null, ziel: null, immoscoutNach: null });
    expect(r.ort?.quelle).toBe("ortsname");
  });
  it("nutzt die Zieladresse nur als markierten Ersatz", () => {
    const r = loeseOrte({ leadId: "x", abholung: { line1: "Unbekannt" }, immoscoutVon: null, ziel: { postcode: "75172" }, immoscoutNach: null });
    expect(r.ort?.quelle).toBe("zieladresse");
    expect(r.ziel?.plz).toBe("75172");
    expect(r.ziel?.quelle).toBe("zieladresse");
  });
  it("löst das Ziel über Freitext, ImmoScout und Ortsname auf", () => {
    const base = { leadId: "x", abholung: null, immoscoutVon: null, ziel: null, immoscoutNach: null };
    expect(loeseOrte({ ...base, ziel: { line1: "Weg 1, 72218 Wildberg" } }).ziel?.plz).toBe("72218");
    expect(loeseOrte({ ...base, immoscoutNach: { zip: "72070" } }).ziel?.plz).toBe("72070");
    const o = loeseOrte({ ...base, ziel: { city: "Nagold" } }).ziel;
    expect(o?.plz).toBeNull();
    expect(o?.genauigkeit).toBe("ort");
    expect(o?.quelle).toBe("zieladresse");
  });
  it("liefert null ohne jede Angabe", () => {
    expect(loeseOrte({ leadId: "x", abholung: null, immoscoutVon: null, ziel: null, immoscoutNach: null })).toEqual({ ort: null, ziel: null });
  });
});

import { describe, expect, it } from "vitest";
import {
  KV_ABLEHNUNGEN,
  KV_BEREICHE,
  KV_EDITOR_FEHLER,
  KV_EDITOR_STATUS,
  KV_EDITOR_TEXT,
  KV_FELDER_CRM,
  KV_FELDER_VPS,
  KV_FELDER_VPS_GEPRUEFT,
  KV_KI_LAEUFT_TEXT,
  KV_KUECHE_TEXTFELDER,
  KV_NUR_ADMIN_TEXT,
  KV_PDF_NICHT_PRUEFBAR_TEXT,
  KV_PREIS_ABWEICHUNG_TEXT,
  feldDefFuer,
  feldFreigeschaltet,
  kvSchluessel,
  kvVerworfenPushText,
  schluesselTeile,
} from "./kv-editor";

const GEDANKENSTRICH = /[–—]/;

describe("Vertrag KV-Editor: Schlüssel", () => {
  it("baut und zerlegt Schlüssel, Ziel darf Doppelpunkte enthalten", () => {
    expect(kvSchluessel("umzugsgut", "inv_8c1", "notiz")).toBe("umzugsgut:inv_8c1:notiz");
    expect(schluesselTeile("umzugsgut:inv_8c1:notiz")).toEqual({
      bereich: "umzugsgut",
      abschnitt: "umzugsgut",
      ziel: "inv_8c1",
      feld: "notiz",
    });
    expect(schluesselTeile("leistungen:a:b:notiz")?.ziel).toBe("a:b");
    expect(schluesselTeile("kueche-leistung:installation:notiz")?.abschnitt).toBe("kueche");
  });

  it("lehnt Unbekanntes und falsche Form ab, Küchenteile gibt es nicht mehr", () => {
    for (const s of ["", "preise:pauschale:betrag", "umzugsgut::notiz", "umzugsgut:x:", "umzugsgut:x", "uebersicht", "kueche-teil:spüle~1:notiz"]) {
      expect(schluesselTeile(s)).toBeNull();
    }
    expect(KV_BEREICHE).not.toContain("kueche-teil");
    expect(() => kvSchluessel("umzugsgut", "", "notiz")).toThrow();
  });
});

describe("Vertrag KV-Editor: Felderliste", () => {
  it("Muster eindeutig, Texte mit Grenze, Zuständigkeit und Zeigen ohne", () => {
    for (const liste of [KV_FELDER_VPS, KV_FELDER_CRM]) {
      expect(new Set(liste.map((d) => d.muster)).size).toBe(liste.length);
      for (const d of liste) {
        if (d.art === "text" || d.art === "langtext") expect(d.max).toBeGreaterThan(0);
        else expect(d.max).toBeUndefined();
      }
    }
    // 4 Übersicht, 2 Leistungen, 5 Umzugsgut, 1 Bilder, 1 Vereinbarungen, 7 Küche, 2 Küchenleistungen
    expect(KV_FELDER_VPS).toHaveLength(22);
    expect(KV_FELDER_CRM.map((d) => d.muster)).toEqual([
      "anschreiben:einleitung:text",
      "uebersicht:zusammenfassung:text",
      "bemerkungen:text:text",
      "anschreiben:schluss:text",
    ]);
  });

  it("„Unsere Arbeiten“ der Küche ist nicht änderbar (Kimi 15)", () => {
    expect(KV_KUECHE_TEXTFELDER).not.toContain("companyWork");
    expect(feldDefFuer("vps", "kueche:companyWork:text")).toBeNull();
    expect(feldDefFuer("vps", "kueche:customerPrep:text")?.max).toBe(1000);
  });

  it("findet die Definition zu konkreten Schlüsseln, Preise nie", () => {
    expect(feldDefFuer("vps", "umzugsgut:abc:montage")?.muster).toBe("umzugsgut:{inventarId}:montage");
    expect(feldDefFuer("vps", "leistungen:transport:zustaendig")?.art).toBe("zustaendig");
    expect(feldDefFuer("vps", "kueche:address:text")).toBeNull();
    expect(feldDefFuer("vps", "uebersicht:termin:datum")).toBeNull();
    expect(feldDefFuer("vps", "anschreiben:einleitung:text")).toBeNull();
    expect(feldDefFuer("crm", "anschreiben:einleitung:text")?.wirkt).toContain("copy.introText");
    expect(feldDefFuer("crm", "preise:pauschale_betrag:text")).toBeNull();
  });

  it("VPS-Felder nach V1: freigegebene Schlüssel und Muster mit Platzhaltern, die fünf ungeprüften Notizen aus", () => {
    const an = [
      "uebersicht:termin:zeit",
      "uebersicht:umzugsgut:text",
      "leistungen:transport:notiz",
      "leistungen:materials:notiz",
      "leistungen:unpacking:zustaendig",
      "leistungen:parkingDestination:zustaendig",
      "umzugsgut:7f3c2a10-inv:bezeichnung",
      "umzugsgut:inv_1:raum",
      "umzugsgut:inv_1:notiz",
      "umzugsgut:inv_1:demontage",
      "umzugsgut:inv_1:montage",
      "bilder:att_99:zeigen",
      "vereinbarungen:text:text",
      "kueche:details:text",
      "kueche:time:text",
      "kueche-leistung:worktop:notiz",
      "kueche-leistung:delivery:zustaendig",
    ];
    for (const s of an) expect(feldFreigeschaltet("vps", s), s).toBe(true);
    const aus = [
      "leistungen:unpacking:notiz",
      "leistungen:parkingDestination:notiz",
      "kueche-leistung:delivery:notiz",
      "kueche-leistung:connections:notiz",
      "kueche-leistung:disposal:notiz",
      "kueche:companyWork:text",
      "uebersicht:termin:datum",
    ];
    for (const s of aus) expect(feldFreigeschaltet("vps", s), s).toBe(false);
    // Jeder Eintrag der Liste ist ein konkreter Schlüssel oder das Muster einer Felddefinition.
    const muster = new Set(KV_FELDER_VPS.map((d) => d.muster));
    for (const s of KV_FELDER_VPS_GEPRUEFT) expect(muster.has(s) || feldDefFuer("vps", s) !== null, s).toBe(true);
  });

  it("Freigabe je Schlüssel oder je Muster; CRM immer", () => {
    expect(feldFreigeschaltet("vps", "vereinbarungen:text:text", new Set())).toBe(false);
    const je = new Set(["leistungen:transport:notiz", "umzugsgut:{inventarId}:notiz"]);
    expect(feldFreigeschaltet("vps", "leistungen:transport:notiz", je)).toBe(true);
    expect(feldFreigeschaltet("vps", "leistungen:packing:notiz", je)).toBe(false);
    expect(feldFreigeschaltet("vps", "umzugsgut:inv_1:notiz", je)).toBe(true);
    expect(feldFreigeschaltet("vps", "leistungen:transport:gibtsnicht", new Set(["leistungen:transport:gibtsnicht"]))).toBe(false);
    expect(feldFreigeschaltet("crm", "bemerkungen:text:text")).toBe(true);
    expect(feldFreigeschaltet("crm", "umzugsgut:abc:notiz")).toBe(false);
  });
});

describe("Vertrag KV-Editor: Fehler und Texte", () => {
  it("jeder Code hat Status und Text, Texte ohne Gedankenstrich", () => {
    for (const f of KV_EDITOR_FEHLER) expect(KV_EDITOR_STATUS[f]).toBeGreaterThanOrEqual(400);
    for (const k of [...KV_EDITOR_FEHLER, ...KV_ABLEHNUNGEN]) {
      expect(KV_EDITOR_TEXT[k].length).toBeGreaterThan(0);
      expect(KV_EDITOR_TEXT[k]).not.toMatch(GEDANKENSTRICH);
    }
    for (const t of [KV_PREIS_ABWEICHUNG_TEXT, KV_PDF_NICHT_PRUEFBAR_TEXT, kvVerworfenPushText(6)]) {
      expect(t).not.toMatch(GEDANKENSTRICH);
    }
    expect(KV_EDITOR_STATUS.NUR_MENSCH).toBe(403);
    expect(KV_EDITOR_STATUS.NUR_ADMIN).toBe(403);
    expect(KV_EDITOR_STATUS.KEIN_KV).toBe(404);
    expect(KV_EDITOR_STATUS.LAEUFT).toBe(409);
    expect(KV_EDITOR_STATUS.VPS_FEHLER).toBe(502);
    expect(KV_EDITOR_STATUS.KI_FEHLER).toBe(504);
  });

  it("Texte aus dem Plan", () => {
    expect(KV_KI_LAEUFT_TEXT).toBe(KV_EDITOR_TEXT.LAEUFT);
    expect(KV_NUR_ADMIN_TEXT).toBe("Nur ein Admin kann ein angenommenes Angebot ändern.");
    expect(KV_EDITOR_TEXT.PREIS).toBe(
      "Preisangaben (Beträge, Prozent, Rabatt, Zahlung) gehören nicht in den Text. Preise änderst du in der Kalkulation."
    );
    expect(kvVerworfenPushText(6)).toBe("Inzwischen wurde Stand 6 gepusht. KV neu erstellen, die Änderungen wandern mit.");
    expect(KV_ABLEHNUNGEN).toContain("NICHT_VORGESCHLAGEN");
  });
});

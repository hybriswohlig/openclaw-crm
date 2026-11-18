import { describe, expect, it } from "vitest";
import { positionSchluessel } from "@/lib/kalkulation-versionen";
import {
  KV_ABLEHNUNGEN,
  KV_EDITOR_FEHLER,
  KV_EDITOR_STATUS,
  KV_EDITOR_TEXT,
  KV_FELDER_CRM,
  KV_FELDER_VPS,
  KV_FELDER_VPS_GEPRUEFT,
  feldDefFuer,
  feldFreigeschaltet,
  kuechenTeilZiel,
  kvNamensSchluessel,
  kvSchluessel,
  schluesselTeile,
  umzugsgutZielOhneId,
} from "./kv-editor";

describe("Vertrag KV-Editor: Schlüssel", () => {
  it("baut und zerlegt Schlüssel, Ziel darf Doppelpunkte enthalten", () => {
    expect(kvSchluessel("umzugsgut", "inv_8c1", "notiz")).toBe("umzugsgut:inv_8c1:notiz");
    expect(schluesselTeile("umzugsgut:inv_8c1:notiz")).toEqual({
      bereich: "umzugsgut",
      abschnitt: "umzugsgut",
      ziel: "inv_8c1",
      feld: "notiz",
    });
    expect(schluesselTeile("umzugsgut:n-regal: weiß~2:notiz")?.ziel).toBe("n-regal: weiß~2");
    expect(schluesselTeile("kueche-teil:spüle~1:notiz")?.abschnitt).toBe("kueche");
  });

  it("lehnt Unbekanntes und falsche Form ab", () => {
    for (const s of ["", "preise:pauschale:betrag", "umzugsgut::notiz", "umzugsgut:x:", "umzugsgut:x", "uebersicht"]) {
      expect(schluesselTeile(s)).toBeNull();
    }
    expect(() => kvSchluessel("umzugsgut", "", "notiz")).toThrow();
  });

  it("Ziele ohne ID folgen positionSchluessel", () => {
    for (const n of ["  Kleiderschrank   3-türig ", "ÜBERSEE-Kiste", "Regal: weiß"]) {
      expect(kvNamensSchluessel(n)).toBe(positionSchluessel(n));
    }
    expect(umzugsgutZielOhneId("Kleiderschrank  3-türig", 2)).toBe("n-kleiderschrank 3-türig~2");
    expect(kuechenTeilZiel("Spüle", 1)).toBe("spüle~1");
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
    expect(KV_FELDER_VPS).toHaveLength(24);
    expect(KV_FELDER_CRM.map((d) => d.muster)).toEqual([
      "anschreiben:einleitung:text",
      "uebersicht:zusammenfassung:text",
      "bemerkungen:text:text",
      "anschreiben:schluss:text",
    ]);
  });

  it("findet die Definition zu konkreten Schlüsseln, Preise nie", () => {
    expect(feldDefFuer("vps", "umzugsgut:abc:montage")?.muster).toBe("umzugsgut:{inventarId}:montage");
    expect(feldDefFuer("vps", "leistungen:transport:zustaendig")?.art).toBe("zustaendig");
    expect(feldDefFuer("vps", "kueche:notes:text")?.max).toBe(1000);
    expect(feldDefFuer("vps", "kueche:address:text")).toBeNull();
    expect(feldDefFuer("vps", "uebersicht:termin:datum")).toBeNull();
    expect(feldDefFuer("vps", "anschreiben:einleitung:text")).toBeNull();
    expect(feldDefFuer("crm", "anschreiben:einleitung:text")?.label).toBe("Einleitung");
    expect(feldDefFuer("crm", "preise:pauschale_betrag:text")).toBeNull();
  });

  it("VPS-Felder erst nach V1, CRM immer", () => {
    expect(KV_FELDER_VPS_GEPRUEFT.size).toBe(0);
    expect(feldFreigeschaltet("vps", "vereinbarungen:text:text")).toBe(false);
    expect(feldFreigeschaltet("vps", "vereinbarungen:text:text", new Set(["vereinbarungen:text:text"]))).toBe(true);
    expect(feldFreigeschaltet("crm", "bemerkungen:text:text")).toBe(true);
    expect(feldFreigeschaltet("crm", "umzugsgut:abc:notiz")).toBe(false);
  });
});

describe("Vertrag KV-Editor: Fehler und Texte", () => {
  it("jeder Code hat Status und Text, Texte ohne Gedankenstrich", () => {
    for (const f of KV_EDITOR_FEHLER) expect(KV_EDITOR_STATUS[f]).toBeGreaterThanOrEqual(400);
    for (const k of [...KV_EDITOR_FEHLER, ...KV_ABLEHNUNGEN]) {
      expect(KV_EDITOR_TEXT[k].length).toBeGreaterThan(0);
      expect(KV_EDITOR_TEXT[k]).not.toMatch(/[–—]/);
    }
    expect(KV_EDITOR_STATUS.NUR_MENSCH).toBe(403);
    expect(KV_EDITOR_STATUS.KEIN_KV).toBe(404);
    expect(KV_EDITOR_STATUS.VPS_FEHLER).toBe(502);
    expect(KV_EDITOR_STATUS.KI_FEHLER).toBe(504);
  });
});

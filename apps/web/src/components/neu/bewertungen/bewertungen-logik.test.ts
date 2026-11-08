import { describe, expect, it } from "vitest";
import type { BewertungZeile } from "@/lib/bewertungen-kunden";
import { LISTEN, SENDEN_RUECKFRAGE, sendenRueckfrage, startListe, zeileAktionen, zeileText } from "./bewertungen-logik";

const z = (e: Partial<BewertungZeile>): BewertungZeile => ({
  dealId: "d",
  dealNummer: null,
  titel: "Anna · Berlin",
  kunde: null,
  firma: null,
  liste: "faellig",
  grund: null,
  faelligAb: null,
  angefragtAm: null,
  geklicktAm: null,
  quelle: null,
  vormerkungId: null,
  tokenFreigebbar: false,
  ...e,
});

describe("bewertungen-logik", () => {
  it("Listen in fester Folge, Start bei der ersten mit Arbeit", () => {
    expect(LISTEN).toEqual(["freigabe", "vorgemerkt", "faellig", "angefragt", "geklickt", "gesperrt"]);
    const leer = { freigabe: 0, vorgemerkt: 0, faellig: 0, angefragt: 3, geklickt: 1, gesperrt: 2 };
    expect(startListe(leer)).toBe("faellig");
    expect(startListe({ ...leer, vorgemerkt: 1 })).toBe("vorgemerkt");
    expect(startListe({ ...leer, freigabe: 2, faellig: 1 })).toBe("freigabe");
  });

  it("Zeittext je Liste", () => {
    expect(zeileText(z({ liste: "vorgemerkt", faelligAb: "2026-11-16T08:00:00.000Z" }))).toBe("Geht Mo 16.11., 9 Uhr raus");
    expect(zeileText(z({ liste: "faellig", faelligAb: "2026-11-09T10:00:00.000Z" }))).toBe("Fällig seit 09.11.2026");
    expect(zeileText(z({ liste: "faellig", grund: "FRIST" }))).toContain("Frist");
    expect(zeileText(z({ liste: "gesperrt", grund: "BESCHWERDE" }))).toBe("Beschwerde im Gespräch: bitte persönlich klären.");
  });

  it("Aktionen je Liste", () => {
    expect(zeileAktionen(z({ liste: "freigabe", vormerkungId: "v" }))).toEqual(["pruefen", "verwerfen"]);
    expect(zeileAktionen(z({ liste: "vorgemerkt", vormerkungId: "v" }))).toEqual(["verwerfen"]);
    expect(zeileAktionen(z({ liste: "faellig" }))).toEqual(["pruefen"]);
    expect(zeileAktionen(z({ liste: "gesperrt", grund: "VERSAND_UNKLAR", tokenFreigebbar: true }))).toEqual(["freigeben"]);
    expect(zeileAktionen(z({ liste: "gesperrt", grund: "BESCHWERDE" }))).toEqual([]);
    expect(zeileAktionen(z({ liste: "angefragt" }))).toEqual([]);
  });
});

describe("Rückfrage Senden", () => {
  it("aus Aus der Plan-Satz, aus Entwurf mit dem Stichtag des Entwurfs", () => {
    expect(sendenRueckfrage("aus", null)).toBe(SENDEN_RUECKFRAGE);
    expect(sendenRueckfrage("entwurf", "2026-10-29T10:00:00.000Z")).toContain("für Zahlungen ab 29.10.2026");
    expect(sendenRueckfrage("entwurf", "2026-10-29T10:00:00.000Z")).not.toMatch(/[–—]/);
  });
});

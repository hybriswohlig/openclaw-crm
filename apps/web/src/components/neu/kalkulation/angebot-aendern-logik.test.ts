import { describe, expect, it } from "vitest";
import type { AnsichtsVorschlag } from "@/services/angebot-aenderung";
import { aendernMoeglich, fotoHinweis, laeuftAn, offene, sperrPunkte, startAuswahl, type AenderungsDaten } from "./angebot-aendern-logik";

const v = (id: string, felder: Partial<AnsichtsVorschlag> = {}): AnsichtsVorschlag => ({
  id, quelle: "chat", aenderung: { art: "kartons", anzahl: 5 }, zitat: "", status: "offen", zeit: "", text: "Umzugskartons: 5", lead: false, ...felder,
});

const daten = (felder: Partial<AenderungsDaten> = {}): AenderungsDaten => ({
  moeglich: true, grund: null,
  basis: { version: 1, preisCent: 100000, gesperrtAm: null, verschickt: true, angenommen: false },
  vorgang: { version: 2, status: "entwurf", preisCent: 110000, fehler: null },
  vorschlaege: [], verlauf: [], chat: { seit: null, ausgewertet: false }, fotos: { offen: 0, gescheitert: 0, neu: 0 },
  vergleich: null, nachricht: null, darfAnnahmeAufheben: true, ...felder,
});

describe("Panel-Logik Angebot ändern", () => {
  it("vorab angehakt: offen, nicht unklar, keine Foto-Dublette", () => {
    const s = startAuswahl([
      v("a"),
      v("b", { aenderung: { art: "unklar", text: "?" } }),
      v("c", { status: "uebernommen" }),
      v("d", { quelle: "foto", foto: { inventarId: "f", fotoUrl: null, mitnehmen: true, dublette: "Kleiderschrank" } }),
      v("e", { quelle: "foto", foto: { inventarId: "g", fotoUrl: null, mitnehmen: true, dublette: null } }),
      v("f", { quelle: "bot" }),
      v("g", { aenderung: { art: "hinweis", text: "Danke" } }),
      v("h", { schonDa: 1 }),
    ]);
    expect([...s]).toEqual(["a", "e"]);
  });

  it("laeuftAn, offene, aendernMoeglich", () => {
    const d = daten({ vorschlaege: [v("a"), v("b", { status: "verworfen" })] });
    expect(laeuftAn(d, 2)).toBe(true);
    expect(laeuftAn(d, 1)).toBe(false);
    expect(offene(d)).toBe(1);
    expect(aendernMoeglich(d, { nummer: 1, status: "gesperrt" })).toBe(true);
    expect(aendernMoeglich(d, { nummer: 2, status: "entwurf" })).toBe(false);
    expect(aendernMoeglich(daten({ moeglich: false, basis: null }), { nummer: 1, status: "gesperrt" })).toBe(false);
  });

  it("Foto-Hinweis und Sperr-Punkte", () => {
    expect(fotoHinweis({ offen: 0, gescheitert: 0 })).toBeNull();
    expect(fotoHinweis({ offen: 2, gescheitert: 1 })).toBe("2 Fotos werden noch ausgewertet, 1 Foto konnte nicht ausgewertet werden.");
    expect(sperrPunkte(daten({ basis: { version: 1, preisCent: 1, gesperrtAm: null, verschickt: true, angenommen: true }, fotos: { offen: 1, gescheitert: 0, neu: 0 } }))).toEqual({
      annahme: true,
      fotos: "1 Foto wird noch ausgewertet.",
      offen: 0,
    });
  });
});

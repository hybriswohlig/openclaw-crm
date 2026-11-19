import { describe, expect, it } from "vitest";
import { KV_EDITOR_TEXT, KV_PDF_NICHT_PRUEFBAR_TEXT, KV_PREIS_ABWEICHUNG_TEXT, type KvStandKopf } from "@/lib/kv-editor";
import { ablehnungText, ablehnungZeilen, antwortAlsEintrag, eigenerEintrag, sendbar, startAuswahl, uebernehmbar, uebernehmenEingabe, type ChatEintrag } from "./kv-chat-logik";
import { DARIO, FIXTURE_JETZT, NURI } from "./kv-editor-fixture";
import { feldTitel, fehlerText, konfliktText, pdfAnsicht, pushbar, pushModus, schluesselTitel, standAbzeichen, verlaufZeilen, zeitText } from "./kv-editor-logik";

const OK = { erwartetCent: [], erlaubtCent: [], preis: "ok" as const, fehlt: [], fremd: [] };

function stand(k: Partial<KvStandKopf> = {}): KvStandKopf {
  return {
    id: "s",
    nummer: 5,
    vorgaengerId: "v",
    renderer: "vps",
    kalkulationVersion: 3,
    quelle: "hand",
    status: "fertig",
    fehler: null,
    aenderungen: [],
    offen: [],
    erstelltVon: DARIO,
    erstelltAm: "2026-11-18T13:12:00Z",
    gepushtVon: null,
    gepushtAm: null,
    aktuell: false,
    dealDocumentId: null,
    grundlageRekonstruiert: false,
    pruefung: OK,
    ...k,
  };
}

const aend = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ schluessel: `vereinbarungen:text:t${i}`, wert: "x", vorher: "", quelle: "hand" as const, von: "u", am: "2026-11-18T13:00:00Z" }));

describe("standAbzeichen", () => {
  it("Entwurf, Aktuell, Wird gedruckt, Fehler, Preisprüfung, früher aktuell", () => {
    expect(standAbzeichen(stand())).toEqual({ text: "Entwurf", ton: "blau" });
    expect(standAbzeichen(stand({ aktuell: true }))).toEqual({ text: "Aktuell", ton: "jade" });
    expect(standAbzeichen(stand({ status: "druckt" })).text).toBe("Wird gedruckt");
    expect(standAbzeichen(stand({ status: "fehler", pruefung: null }))).toEqual({ text: "Fehler", ton: "rose" });
    expect(standAbzeichen(stand({ status: "fehler", pruefung: { ...OK, preis: "abweichung" } })).text).toBe("Preisprüfung fehlgeschlagen");
    expect(standAbzeichen(stand({ status: "fehler", pruefung: { ...OK, preis: "nicht_lesbar" } })).text).toBe("Preisprüfung fehlgeschlagen");
    expect(standAbzeichen(stand({ gepushtAm: "2026-11-18T12:00:00Z" })).text).toBe("Früher aktuell");
    expect(standAbzeichen(stand({ quelle: "ausgang", dealDocumentId: "d1" })).text).toBe("Früher aktuell");
  });
});

describe("pdfAnsicht", () => {
  it("Aufgabe 8 (Grok 2): aktueller KV mit fehlgeschlagener Prüfung zeigt das PDF mit Warnung und Abzeichen", () => {
    const s = stand({ aktuell: true, dealDocumentId: "d1", fehler: KV_PREIS_ABWEICHUNG_TEXT, pruefung: { ...OK, preis: "abweichung", fehlt: [], fremd: [99900] } });
    expect(pdfAnsicht(s)).toEqual({
      art: "pdf",
      warnung: { titel: "Preisprüfung fehlgeschlagen", text: KV_PREIS_ABWEICHUNG_TEXT, details: ["Steht zusätzlich im Druck: 999 €"] },
    });
    expect(standAbzeichen(s)).toEqual({ text: "Aktuell, Preis prüfen", ton: "gold" });
    expect(pdfAnsicht(stand({ aktuell: true, pruefung: { ...OK, preis: "nicht_lesbar" } }))).toMatchObject({ art: "pdf", warnung: { text: KV_PDF_NICHT_PRUEFBAR_TEXT } });
  });

  it("fertig zeigt das PDF, druckt einen Platzhalter (VPS mit Preisprüfung)", () => {
    expect(pdfAnsicht(stand())).toEqual({ art: "pdf" });
    const d = pdfAnsicht(stand({ status: "druckt" }));
    expect(d.art).toBe("druckt");
    expect(d.art === "druckt" && d.text).toContain("auf den Preis geprüft");
    const c = pdfAnsicht(stand({ status: "druckt", renderer: "crm", pruefung: null }));
    expect(c.art === "druckt" && c.text).toBe("Der KV wird gedruckt.");
  });

  it("Preisabweichung mit fehlenden und fremden Beträgen in Euro", () => {
    const a = pdfAnsicht(stand({ status: "fehler", fehler: null, pruefung: { ...OK, preis: "abweichung", fehlt: [162000], fremd: [126000, 5050] } }));
    expect(a).toEqual({
      art: "fehler",
      titel: "Preisprüfung fehlgeschlagen",
      text: KV_PREIS_ABWEICHUNG_TEXT,
      details: ["Fehlt im Druck: 1.620 €", "Steht zusätzlich im Druck: 1.260 €, 50,50 €"],
    });
  });

  it("nicht lesbar und sonstiger Fehler", () => {
    const n = pdfAnsicht(stand({ status: "fehler", pruefung: { ...OK, preis: "nicht_lesbar" } }));
    expect(n.art === "fehler" && n.text).toBe(KV_PDF_NICHT_PRUEFBAR_TEXT);
    const f = pdfAnsicht(stand({ status: "fehler", fehler: "VPS weg", pruefung: null }));
    expect(f).toEqual({ art: "fehler", titel: "Druck fehlgeschlagen", text: "VPS weg", details: [] });
  });
});

describe("verlaufZeilen", () => {
  const jetzt = FIXTURE_JETZT;

  it("zeitText: heute nur Uhrzeit, sonst mit Tag (Berlin)", () => {
    expect(zeitText("2026-11-18T13:12:00Z", jetzt)).toBe("14:12");
    expect(zeitText("2026-11-17T08:40:00Z", jetzt)).toBe("Di 17.11., 09:40");
  });

  it("Hand: Zeit, Person, Anzahl", () => {
    expect(verlaufZeilen(stand({ aenderungen: aend(3) }), jetzt)).toEqual(["14:12 · Dario", "3 Änderungen"]);
    expect(verlaufZeilen(stand({ aenderungen: aend(1) }), jetzt)).toEqual(["14:12 · Dario", "1 Änderung"]);
  });

  it("KI im Auftrag von …", () => {
    expect(verlaufZeilen(stand({ quelle: "ki", aenderungen: aend(2) }), jetzt)).toEqual(["14:12", "KI im Auftrag von Dario", "2 Änderungen"]);
  });

  it("mitgewandert: aus Kalkulation v3, übernommen, offen", () => {
    const s = stand({
      quelle: "mitgewandert",
      erstelltVon: null,
      aenderungen: aend(4),
      offen: [
        { aenderung: aend(1)[0], art: "ziel_fehlt", basisJetzt: null, status: "offen" },
        { aenderung: aend(1)[0], art: "ziel_fehlt", basisJetzt: null, status: "verworfen" },
      ],
    });
    expect(verlaufZeilen(s, jetzt)).toEqual(["14:12", "aus Kalkulation v3, 4 übernommen, 1 offen"]);
  });

  it("aktuell seit, gepusht von", () => {
    const s = stand({ aktuell: true, gepushtVon: NURI, gepushtAm: "2026-11-18T12:50:00Z" });
    expect(verlaufZeilen(s, jetzt)).toContain("Aktuell seit 13:50, gepusht von Nuri");
    expect(verlaufZeilen(stand({ gepushtVon: NURI, gepushtAm: "2026-11-18T12:50:00Z" }), jetzt)).toContain("Gepusht 13:50 von Nuri");
    expect(verlaufZeilen(stand({ quelle: "ausgang", erstelltVon: null, grundlageRekonstruiert: true, aktuell: true }), jetzt)).toEqual([
      "14:12",
      "Ausgangs-KV, entstand vor dem Editor",
      "Aktuell",
    ]);
  });
});

describe("pushbar und pushModus", () => {
  it("nur fertiger, nie gepushter Entwurf mit bestandener Preisprüfung", () => {
    expect(pushbar(stand())).toBe(true);
    expect(pushbar(stand({ renderer: "crm", pruefung: null }))).toBe(true);
    expect(pushbar(stand({ aktuell: true }))).toBe(false);
    expect(pushbar(stand({ gepushtAm: "2026-11-18T12:00:00Z" }))).toBe(false);
    expect(pushbar(stand({ status: "druckt" }))).toBe(false);
    expect(pushbar(stand({ status: "fehler" }))).toBe(false);
    expect(pushbar(stand({ pruefung: { ...OK, preis: "offen" } }))).toBe(false);
  });

  it("Annahme: Admin bestätigt, sonst gesperrt", () => {
    const annahme = (aktiv: boolean, aufhebenErlaubt: boolean) => ({ annahme: { aktiv, am: null, standNummer: 2, aufhebenErlaubt } });
    expect(pushModus(annahme(false, false))).toBe("einfach");
    expect(pushModus(annahme(true, true))).toBe("annahme_admin");
    expect(pushModus(annahme(true, false))).toBe("annahme_gesperrt");
  });
});

describe("fehlerText", () => {
  it("bekannte Codes aus KV_EDITOR_TEXT, mit Zusatzdaten", () => {
    expect(fehlerText("LAEUFT", "egal")).toBe(KV_EDITOR_TEXT.LAEUFT);
    expect(fehlerText("NUR_ADMIN", "egal")).toBe(KV_EDITOR_TEXT.NUR_ADMIN);
    expect(fehlerText("AKTUELL_GEAENDERT", "egal", { aktuellStandNummer: 6, gepushtVon: "Nuri" })).toBe("Nuri hat inzwischen Stand 6 gepusht.");
    expect(fehlerText("AKTUELL_GEAENDERT", "egal", { aktuellStandNummer: null })).toBe(KV_EDITOR_TEXT.AKTUELL_GEAENDERT);
    expect(fehlerText("KALKULATION_NEU", "egal", { kalkulationVersion: 4 })).toContain("v4");
    expect(fehlerText("ANGABEN_FEHLEN", "egal", { text: "Auszugsadresse fehlt." })).toBe("Auszugsadresse fehlt.");
  });

  it("unbekannter Code oder ohne Code: Meldung des Servers", () => {
    expect(fehlerText(null, "Keine Verbindung zum Server.")).toBe("Keine Verbindung zum Server.");
    expect(fehlerText("ANDERS", "Serverfehler")).toBe("Serverfehler");
  });

  it("nicht_erlaubt: ohne Basis fehlt die Freigabe der Leistungsart, mit Basis der Preis (V2)", () => {
    expect(konfliktText({ art: "nicht_erlaubt", basisJetzt: null } as never)).toBe("Dieses Feld druckt der KV bei dieser Leistungsart nicht.");
    expect(konfliktText({ art: "nicht_erlaubt", basisJetzt: "customer" } as never)).toBe("Im Preis nicht mehr enthalten. Über die Kalkulation ändern.");
  });

  it("keine Gedankenstriche in den Texten", () => {
    for (const t of [fehlerText("AKTUELL_GEAENDERT", "", { aktuellStandNummer: 6, gepushtVon: "Nuri" }), konfliktText({ art: "ziel_fehlt" } as never)]) {
      expect(t).not.toMatch(/[–—]/);
    }
  });
});

describe("Titel", () => {
  it("Feld mit Gruppe, sonst Label; Schlüssel aus fester Liste oder roh", () => {
    expect(feldTitel({ gruppe: "Transport", label: "Notiz" })).toBe("Transport, Notiz");
    expect(feldTitel({ label: "Uhrzeit" })).toBe("Uhrzeit");
    expect(schluesselTitel("umzugsgut:inv_x:notiz", [], "vps")).toBe("Umzugsgut, Notiz");
    expect(schluesselTitel("vereinbarungen:text:text", [], "vps")).toBe("Ergänzende Vereinbarungen");
    expect(schluesselTitel("gibt:es:nicht", [], "vps")).toBe("gibt:es:nicht");
  });
});

describe("Chat-Logik", () => {
  const vorschlag = (schluessel: string, wert: string) => ({
    schluessel,
    abschnitt: "uebersicht" as const,
    label: "Uhrzeit",
    vorher: "ab 8:00 Uhr",
    nachher: wert,
    wert,
    art: "geaendert" as const,
  });
  const antwort = {
    antwort: "Zwei Änderungen.",
    vorschlaege: [vorschlag("uebersicht:termin:zeit", "ab 8:30 Uhr"), vorschlag("vereinbarungen:text:text", "Keller leer")],
    abgelehnt: [
      { schluessel: null, grund: "PREIS" as const },
      { schluessel: "x", grund: "PREIS" as const },
      { schluessel: null, grund: "LEER" as const },
    ],
    nachrichtId: "ev_1",
  };

  it("Übernehmen nur die angehakten, mit kiNachrichtId und Stand des Chats", () => {
    const e = antwortAlsEintrag(antwort, "st_3", "2026-11-18T13:00:00Z");
    const auswahl = startAuswahl(antwort.vorschlaege);
    expect([...auswahl]).toEqual(["uebersicht:termin:zeit", "vereinbarungen:text:text"]);
    auswahl.delete("vereinbarungen:text:text");
    expect(uebernehmenEingabe(e, auswahl)).toEqual({
      vorgaengerId: "st_3",
      setzen: [{ schluessel: "uebersicht:termin:zeit", wert: "ab 8:30 Uhr" }],
      zuruecksetzen: [],
      kiNachrichtId: "ev_1",
    });
    expect(uebernehmenEingabe(e, new Set())).toBeNull();
  });

  it("ältere KI-Beiträge aus dem Verlauf sind übernehmbar, übernommene und solche ohne ID nicht", () => {
    const e = antwortAlsEintrag(antwort, "st_3", "2026-11-18T13:00:00Z");
    expect(e.uebernommen).toBe(false);
    expect(uebernehmbar(e)).toBe(true);
    expect(uebernehmbar({ ...e, uebernommen: true })).toBe(false);
    const alt: ChatEintrag = { rolle: "ki", text: "Alt", am: "2026-11-18T12:00:00Z", von: "u_dario", standId: "st_2", nachrichtId: "ev_alt", uebernommen: false, vorschlaege: antwort.vorschlaege };
    expect(uebernehmbar(alt)).toBe(true);
    expect(uebernehmenEingabe(alt, startAuswahl(antwort.vorschlaege))?.vorgaengerId).toBe("st_2");
    const ohne: ChatEintrag = { ...e, nachrichtId: "" };
    expect(uebernehmbar(ohne)).toBe(false);
    expect(uebernehmenEingabe(ohne, startAuswahl(antwort.vorschlaege))).toBeNull();
    expect(uebernehmbar(eigenerEintrag("Hallo", "st_3", "2026-11-18T13:00:00Z"))).toBe(false);
  });

  it("Ablehnungen je Grund gezählt, LEER mit eigenem Text", () => {
    expect(ablehnungText("LEER")).toBe("Dazu kann ich im KV nichts ändern.");
    expect(ablehnungZeilen(antwort.abgelehnt)).toEqual([`${KV_EDITOR_TEXT.PREIS} (2)`, "Dazu kann ich im KV nichts ändern."]);
  });

  it("sendbar: nicht leer, höchstens 2000 Zeichen", () => {
    expect(sendbar("  ")).toBe(false);
    expect(sendbar("Uhrzeit 8:30")).toBe(true);
    expect(sendbar("x".repeat(2001))).toBe(false);
  });
});

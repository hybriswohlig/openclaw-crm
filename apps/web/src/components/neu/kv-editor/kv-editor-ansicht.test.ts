import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { KV_EDITOR_TEXT, KV_HINWEIS_FELDER_GEPRUEFT, KV_HINWEIS_REKONSTRUIERT, KV_NUR_ADMIN_TEXT, type KvEditorAnsicht, type KvStandDetail } from "@/lib/kv-editor";
import { KvGepusht, KvHinweis, KvKonflikte } from "./kv-baender";
import { KvChat } from "./kv-chat";
import { antwortAlsEintrag } from "./kv-chat-logik";
import { PushInhalt, ZusammenfuehrenInhalt } from "./kv-dialoge";
import { FIXTURE_JETZT, fixtureQuelle, type KvSzenario } from "./kv-editor-fixture";
import { KvFormular } from "./kv-formular";
import { dreiwege } from "./kv-formular-logik";
import { KvKopf } from "./kv-kopf";
import { KvPdf } from "./kv-pdf";
import { KvVerlauf } from "./kv-verlauf";

// Vitest übersetzt JSX klassisch (React.createElement): React global bereitstellen.
(globalThis as { React?: typeof React }).React = React;

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const text = (h: string) =>
  h
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

async function daten(szenario: KvSzenario = "standard") {
  const q = fixtureQuelle(szenario, { druckMs: 0, kiMs: 0, jetzt: () => FIXTURE_JETZT });
  const a = await q.ansicht();
  if (!a.ok) throw new Error(a.message);
  const neuester = a.data.staende[0];
  const d = neuester ? await q.stand(neuester.id) : null;
  if (d && !d.ok) throw new Error(d.message);
  return { q, ansicht: a.data, detail: d?.data ?? null };
}

function formular(detail: KvStandDetail, ansicht: KvEditorAnsicht, extra: Partial<Parameters<typeof KvFormular>[0]> = {}) {
  return html(createElement(KvFormular, { stand: detail, firma: ansicht.firma, preis: ansicht.preis, fehler: null, speichert: false, onSpeichern: vi.fn(), onSchliessen: vi.fn(), ...extra }));
}

describe("Kopf", () => {
  it("Verlauf links, Kunde, Abzeichen, Kalkulation, rechts Bearbeiten, Sprechblase, Pushen", async () => {
    const { ansicht } = await daten();
    const h = html(
      createElement(KvKopf, {
        ansicht,
        stand: ansicht.staende[0],
        verlaufOffen: false,
        rechts: "chat",
        pushSichtbar: true,
        bearbeitbar: true,
        beschaeftigt: false,
        onVerlauf: vi.fn(),
        onRechts: vi.fn(),
        onPushen: vi.fn(),
      })
    );
    const t = text(h);
    expect(t).toMatch(/Verlauf .*‹ Akte KV · Alex Beispiel Stand 3 · Entwurf Kalkulation v3 .*Bearbeiten .*Pushen/);
    expect(h).toContain('aria-label="KI-Chat" aria-pressed="true"');
    expect(h).toContain('href="/app/leads/deal_beispiel"');
  });
});

describe("Verlauf", () => {
  it("Stände neueste oben mit Zeit, Person, KI, Push; Knöpfe je Stand", async () => {
    const { ansicht, detail } = await daten();
    const h = html(
      createElement(KvVerlauf, {
        staende: ansicht.staende,
        gewaehltId: "st_3",
        felder: detail!.basis.felder,
        firma: "kottke",
        jetzt: FIXTURE_JETZT,
        pdfUrl: (id) => `/pdf/${id}`,
        beschaeftigt: false,
        onAnsehen: vi.fn(),
        onAlsEntwurf: vi.fn(),
        onSchliessen: vi.fn(),
      })
    );
    const t = text(h);
    expect(t).toContain("Stand 3 Entwurf 14:12 KI im Auftrag von Dario 4 Änderungen Änderungen zeigen (4) PDF öffnen");
    expect(t).toContain("Stand 2 Aktuell Di 17.11., 09:40 · Nuri 2 Änderungen Aktuell seit 13:50, gepusht von Nuri");
    expect(t).toContain("Stand 1 Früher aktuell Mo 16.11., 10:00 Ausgangs-KV, entstand vor dem Editor Ansehen PDF öffnen Als neuen Entwurf verwenden");
    // Der neueste Stand hat kein „Als neuen Entwurf verwenden“, der gezeigte kein „Ansehen“.
    expect(t.match(/Als neuen Entwurf verwenden/g)).toHaveLength(2);
    expect(h).toContain('<li class="kve-stand" aria-current="true">');
  });
});

describe("PDF-Fläche", () => {
  it("fertig: iframe und Handy-Karte mit PDF öffnen", async () => {
    const { ansicht } = await daten();
    const h = html(createElement(KvPdf, { stand: ansicht.staende[0], pdfUrl: "/x.pdf", jetzt: FIXTURE_JETZT, beschaeftigt: false, onNeuDrucken: vi.fn() }));
    expect(h).toContain('<iframe class="kve-iframe" src="/x.pdf" title="KV, Stand 3"');
    expect(text(h)).toContain("PDF öffnen");
  });

  it("druckt, Fehler und Preisprüfung mit Neu drucken", async () => {
    const druckt = (await daten("druckt")).ansicht.staende[0];
    expect(text(html(createElement(KvPdf, { stand: druckt, pdfUrl: null, jetzt: FIXTURE_JETZT, beschaeftigt: false, onNeuDrucken: vi.fn() })))).toContain("Stand 3 wird gedruckt");
    const fehler = (await daten("fehler")).ansicht.staende[0];
    const hf = text(html(createElement(KvPdf, { stand: fehler, pdfUrl: null, jetzt: FIXTURE_JETZT, beschaeftigt: false, onNeuDrucken: vi.fn() })));
    expect(hf).toContain("Druck fehlgeschlagen Der Druckdienst hat nicht geantwortet");
    expect(hf).toContain("Neu drucken");
    const preis = (await daten("preis")).ansicht.staende[0];
    const hp = text(html(createElement(KvPdf, { stand: preis, pdfUrl: "/x.pdf", jetzt: FIXTURE_JETZT, beschaeftigt: false, onNeuDrucken: vi.fn() })));
    expect(hp).toContain("Preisprüfung fehlgeschlagen");
    expect(hp).toContain("Fehlt im Druck: 1.620 €");
    expect(hp).toContain("Steht zusätzlich im Druck: 1.260 €");
    expect(hp).not.toContain("iframe");
  });
});

describe("Formular Bearbeiten", () => {
  it("Preis nur lesend mit Preis ändern, Abschnitte wie der KV, Firma ausgegraut", async () => {
    const { ansicht, detail } = await daten();
    const h = formular(detail!, ansicht);
    const t = text(h);
    expect(t).toContain("Preis Gesamtpreis 1.620 € aus Kalkulation v3");
    expect(h).toContain('href="/app/leads/deal_beispiel/kalkulation">Preis ändern</a>');
    const abschnitte = [...h.matchAll(/<section class="kve-abschnitt[^"]*" aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(abschnitte).toEqual(["Preis", "Projektübersicht", "Unsere Leistungen", "Umzugsgut", "Ihre Bilder", "Ergänzende Vereinbarungen"]);
    // Möbelmontage: Kottke nicht im Preis → ausgegraut, mit Text aus KV_EDITOR_TEXT.
    expect(h).toMatch(/<label data-gesperrt="true" title="Im Preis nicht enthalten\. Über die Kalkulation ändern\."><input type="radio" disabled="" name="[^"]+" value="company"\/>/);
    expect(t).toContain(KV_EDITOR_TEXT.FIRMA_GESPERRT);
    // Geänderte Felder sind markiert, Speichern ist ohne Änderung gesperrt.
    expect(t).toMatch(/Uhrzeit geändert/);
    expect(h).toMatch(/<button type="submit" class="kve-knopf" disabled="">Speichern<\/button>/);
  });

  it("Fehler aus 400 UNGUELTIG am Feld und allgemein", async () => {
    const { ansicht, detail } = await daten();
    const h = formular(detail!, ansicht, {
      fehler: {
        meldung: KV_EDITOR_TEXT.UNGUELTIG,
        abgelehnt: [
          { schluessel: "vereinbarungen:text:text", grund: "PREIS" },
          { schluessel: null, grund: "UNBEKANNT" },
        ],
      },
    });
    expect(h).toMatch(/aria-invalid="true" aria-describedby="[^"]+-fehler"/);
    expect(text(h)).toContain(KV_EDITOR_TEXT.PREIS);
    expect(text(h)).toContain(`${KV_EDITOR_TEXT.UNGUELTIG} ${KV_EDITOR_TEXT.UNBEKANNT}`);
  });

  it("VPS vor V1: Hinweis Felder werden geprüft; Altbestand: Umzugsgut nur lesend", async () => {
    const u = await daten("ungeprueft");
    expect(text(formular(u.detail!, u.ansicht))).toContain(KV_HINWEIS_FELDER_GEPRUEFT);
    const a = await daten("altbestand");
    const t = text(formular(a.detail!, a.ansicht));
    expect(t).toContain("Umzugsgut Kleiderschrank 3-türig · Schlafzimmer Waschmaschine · Bad Umzugsgut in der Kalkulation ändern.");
  });

  it("Ceylan: Anschreiben, Leistung, Bemerkungen", async () => {
    const { ansicht, detail } = await daten("ceylan");
    const t = text(formular(detail!, ansicht));
    expect(t).toMatch(/Anschreiben Einleitung .* Schluss .* Projektübersicht Leistung .* Bemerkungen Bemerkungen geändert/);
  });
});

describe("Chat", () => {
  it("Vorschlagskarte mit alt → neu, Übernehmen (n), Ablehnungen", async () => {
    const { q, ansicht, detail } = await daten();
    const r = await q.chat({ standId: "st_3", text: "Uhrzeit halb neun, Sofa Füße ab, Montage durch uns" });
    if (!r.ok) throw new Error(r.message);
    const h = html(
      createElement(KvChat, {
        eintraege: [antwortAlsEintrag(r.data, "st_3", "2026-11-18T13:20:00Z")],
        felder: detail!.basis.felder,
        firma: ansicht.firma,
        jetzt: FIXTURE_JETZT,
        sendet: false,
        uebernimmt: null,
        fehler: KV_EDITOR_TEXT.LAEUFT,
        onSenden: vi.fn(async () => true),
        onUebernehmen: vi.fn(),
        onSchliessen: vi.fn(),
      })
    );
    const t = text(h);
    expect(t).toContain("Vorschlag Uhrzeit · Projektübersicht ab 7:30 Uhr → ab 8:30 Uhr");
    expect(t).toContain("Sofa, 3-Sitzer, Notiz · Umzugsgut leer → Füße vorher abschrauben");
    expect(t).toContain("Übernehmen (2)");
    expect(t).toContain(KV_EDITOR_TEXT.FIRMA_GESPERRT);
    expect(t).toContain(KV_EDITOR_TEXT.LAEUFT);
  });

  it("Preisbitte: keine Karte, Ablehnung PREIS; ältere Vorschläge aus dem Verlauf übernehmbar, übernommene nicht", async () => {
    const { q, detail } = await daten();
    const r = await q.chat({ standId: "st_3", text: "Gib 10 % Rabatt" });
    if (!r.ok) throw new Error(r.message);
    expect(r.data.vorschlaege).toEqual([]);
    const h = html(
      createElement(KvChat, {
        eintraege: [
          { ...antwortAlsEintrag(r.data, "st_3", "2026-11-18T13:20:00Z") },
          { rolle: "ki", text: "Alt", am: "2026-11-18T12:00:00Z", von: null, standId: "st_2", nachrichtId: "ev_alt", uebernommen: false, vorschlaege: [{ ...detail!.unterschied[0], wert: "x" }] },
          { rolle: "ki", text: "Älter", am: "2026-11-18T11:00:00Z", von: null, standId: "st_1", nachrichtId: "ev_aelter", uebernommen: true, vorschlaege: [{ ...detail!.unterschied[0], wert: "y" }] },
        ],
        felder: detail!.basis.felder,
        firma: "kottke",
        jetzt: FIXTURE_JETZT,
        sendet: false,
        uebernimmt: null,
        fehler: null,
        onSenden: vi.fn(async () => true),
        onUebernehmen: vi.fn(),
        onSchliessen: vi.fn(),
      })
    );
    expect(text(h)).toContain(KV_EDITOR_TEXT.PREIS);
    expect(text(h)).toContain("Übernehmen (1)");
    expect(text(h)).toContain("Übernommen");
    expect(text(h)).not.toContain("Vorschlag (nur Ansicht)");
  });
});

describe("Nach dem Push", () => {
  it("Im Chat senden bereitet „KV angepasst“ vor, mit Bitte um neue Annahme nur nach Aufhebung", () => {
    const mit = html(createElement(KvGepusht, { dealId: "deal_1", nummer: 4, annahmeAufgehoben: true, onSchliessen: vi.fn() }));
    expect(text(mit)).toContain("Stand 4 ist jetzt der aktuelle KV.");
    expect(text(mit)).toContain("Die Annahme ist aufgehoben");
    expect(mit).toContain('href="/app/inbox?e=deal%3Adeal_1&amp;kv=angepasst&amp;annahme=1"');
    const ohne = html(createElement(KvGepusht, { dealId: "deal_1", nummer: 4, annahmeAufgehoben: false, onSchliessen: vi.fn() }));
    expect(ohne).toContain('href="/app/inbox?e=deal%3Adeal_1&amp;kv=angepasst"');
    expect(text(ohne)).not.toContain("Annahme ist aufgehoben");
  });
});

describe("Push-Dialog", () => {
  const props = { laeuft: false, fehler: null, onPushen: vi.fn(), onAbbrechen: vi.fn() };

  it("ohne Annahme: einfache Rückfrage, Push schickt keine Nachricht", async () => {
    const { ansicht } = await daten();
    const t = text(html(createElement(PushInhalt, { stand: ansicht.staende[0], ansicht, ...props })));
    expect(t).toContain("Stand 3 wird der aktuelle KV");
    expect(t).toContain("Eine Nachricht an den Kunden geht dabei nicht raus");
    expect(t).not.toContain("Annahme aufheben?");
    expect(t).toMatch(/Abbrechen Pushen $/);
  });

  it("Annahme, Admin: Rückfrage mit Haken, Knopf erst nach Haken", async () => {
    const { ansicht } = await daten("annahme");
    const h = html(createElement(PushInhalt, { stand: ansicht.staende[0], ansicht, ...props }));
    expect(text(h)).toContain("Annahme aufheben? Der Kunde hat Stand 2 am Mi 18.11. schon angenommen.");
    expect(text(h)).toContain("Annahme aufheben, der Kunde nimmt neu an");
    expect(h).toMatch(/<button type="button" disabled="" class="lg-button lg-button--primary[^]*Annahme aufheben und pushen/);
  });

  it("Annahme, kein Admin: ohne Knopf, mit Hinweis", async () => {
    const { ansicht } = await daten("annahme-member");
    const t = text(html(createElement(PushInhalt, { stand: ansicht.staende[0], ansicht, ...props })));
    expect(t).toContain(KV_NUR_ADMIN_TEXT);
    expect(t).not.toMatch(/pushen$/i);
    expect(t).toMatch(/Schließen $/);
  });
});

describe("Zusammenführen", () => {
  it("Konflikt je Feld mit deins und Stand N", async () => {
    const { detail } = await daten();
    const neuester = { ...detail!, id: "st_4", nummer: 4, erstelltVon: { id: "u_nuri", name: "Nuri" }, aenderungen: [...detail!.aenderungen.filter((a) => a.schluessel !== "uebersicht:termin:zeit"), { ...detail!.aenderungen[0], wert: "ab 7:00 Uhr" }] };
    const ergebnis = dreiwege(detail!.basis, detail!.aenderungen, { "uebersicht:termin:zeit": "ab 10:00 Uhr", "leistungen:transport:zustaendig": "none" }, neuester.aenderungen);
    const t = text(html(createElement(ZusammenfuehrenInhalt, { ergebnis, neuester, firma: "kottke", laeuft: false, fehler: null, onSpeichern: vi.fn(), onAbbrechen: vi.fn() })));
    expect(t).toContain(`${KV_EDITOR_TEXT.STAND_VERALTET} Stand 4 von Nuri.`);
    expect(t).toContain("1 Änderung von dir geht ohne Rückfrage mit.");
    expect(t).toContain("Uhrzeit Deins ab 10:00 Uhr Stand 4 ab 7:00 Uhr");
  });
});

describe("Bänder", () => {
  it("Konflikte gelb: übernehmen nur bei basis_geaendert", async () => {
    const { ansicht, detail } = await daten("konflikt");
    const t = text(html(createElement(KvKonflikte, { stand: ansicht.staende[0], felder: detail!.basis.felder, firma: "kottke", beschaeftigt: false, onEntscheiden: vi.fn() })));
    expect(t).toContain("2 Änderungen passen nicht mehr zum neuen KV aus Kalkulation v4.");
    expect(t).toContain("Uhrzeit Im neuen KV steht hier inzwischen etwas anderes. Deine Änderung: ab 7:30 Uhr · Im neuen KV: ab 9:00 Uhr übernehmen verwerfen");
    expect(t).toContain("Umzugsgut, Notiz Diese Zeile gibt es im neuen KV nicht mehr. Deine Änderung: Klavier mit Gurt verwerfen");
  });

  it("Hinweise rekonstruiert und quelle_ohne_stand", async () => {
    const r = await daten("rekonstruiert");
    expect(text(html(createElement(KvHinweis, { ansicht: r.ansicht, beschaeftigt: false, onUebertragen: vi.fn() })))).toContain(KV_HINWEIS_REKONSTRUIERT);
    const o = await daten("quelle-ohne-stand");
    expect(text(html(createElement(KvHinweis, { ansicht: o.ansicht, beschaeftigt: false, onUebertragen: vi.fn() })))).toContain(
      "Der aktuelle KV stammt nicht aus dem Editor. Änderungen aus Stand 3 übertragen"
    );
  });
});

describe("Testdaten-Quelle (Abläufe wie der Vertrag)", () => {
  it("Speichern mit Preis im Text: 400 UNGUELTIG mit PREIS am Feld", async () => {
    const { q } = await daten();
    const r = await q.standAnlegen({ vorgaengerId: "st_3", setzen: [{ schluessel: "vereinbarungen:text:text", wert: "10 % Rabatt" }], zuruecksetzen: [] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("UNGUELTIG");
    expect((r.fehler as { daten: unknown }).daten).toEqual({ abgelehnt: [{ schluessel: "vereinbarungen:text:text", grund: "PREIS" }] });
  });

  it("Speichern druckt, dann fertig; veralteter Vorgänger: 409 STAND_VERALTET mit neuestem Stand", async () => {
    const { q } = await daten();
    const r = await q.standAnlegen({ vorgaengerId: "st_3", setzen: [{ schluessel: "uebersicht:termin:zeit", wert: "ab 9 Uhr" }], zuruecksetzen: [] });
    if (!r.ok) throw new Error(r.message);
    expect(r.data).toMatchObject({ nummer: 4, status: "druckt", quelle: "hand" });
    const d = await q.stand(r.data.id);
    expect(d.ok && d.data.status).toBe("fertig");
    expect(d.ok && d.data.unterschied.map((z) => [z.label, z.vorher, z.nachher, z.art])).toEqual([["Uhrzeit", "ab 7:30 Uhr", "ab 9 Uhr", "geaendert"]]);
    const alt = await q.standAnlegen({ vorgaengerId: "st_3", setzen: [{ schluessel: "uebersicht:termin:zeit", wert: "ab 10 Uhr" }], zuruecksetzen: [] });
    expect(!alt.ok && alt.code).toBe("STAND_VERALTET");
  });

  it("Pushen mit Annahme: ohne Bestätigung ANNAHME_AKTIV, Mitglied NUR_ADMIN, Admin hebt auf", async () => {
    const m = await daten("annahme-member");
    const a1 = await m.q.pushen("st_3", { erwartetAktuellDokumentId: "doc_2" });
    expect(!a1.ok && a1.code).toBe("ANNAHME_AKTIV");
    const a2 = await m.q.pushen("st_3", { erwartetAktuellDokumentId: "doc_2", annahmeAufhebenBestaetigt: true });
    expect(!a2.ok && a2.code).toBe("NUR_ADMIN");
    const ad = await daten("annahme");
    const ok = await ad.q.pushen("st_3", { erwartetAktuellDokumentId: "doc_2", annahmeAufhebenBestaetigt: true });
    expect(ok.ok && ok.data.annahmeAufgehoben).toBe(true);
    const nach = await ad.q.ansicht();
    expect(nach.ok && [nach.data.aktuellStandId, nach.data.annahme.aktiv]).toEqual(["st_3", false]);
  });

  it("Preisprüfung fehlgeschlagen: nicht pushbar", async () => {
    const { q } = await daten("preis");
    const r = await q.pushen("st_3", { erwartetAktuellDokumentId: "doc_2" });
    expect(!r.ok && r.code).toBe("STAND_NICHT_FERTIG");
  });

  it("KI-Vorschlag übernehmen mit kiNachrichtId ergibt Stand quelle ki", async () => {
    const { q } = await daten();
    const k = await q.chat({ standId: "st_3", text: "Uhrzeit halb neun" });
    if (!k.ok) throw new Error(k.message);
    const r = await q.standAnlegen({ vorgaengerId: "st_3", setzen: [{ schluessel: k.data.vorschlaege[0].schluessel, wert: k.data.vorschlaege[0].wert }], zuruecksetzen: [], kiNachrichtId: k.data.nachrichtId });
    expect(r.ok && r.data.quelle).toBe("ki");
  });
});

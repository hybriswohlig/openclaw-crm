import { describe, expect, it } from "vitest";
import { berechneKennzahlen } from "@/services/lagekarte/kennzahlen";
import { erzeugeMissionen } from "@/services/lagekarte/missionen";
import { kundeSchriebZuletzt, wartetAuf, type ThreadSignal } from "@/services/lagekarte/wartet";
import { beispielAntwort, beispielChatVorschau, beispielVerlauf } from "./beispiel-daten";
import type { ChatKurz, LeadPunkt, MissionArt } from "./typen";

const jetzt = new Date("2026-10-08T07:30:00+02:00");
const daten = beispielAntwort(jetzt);
const mitChat = daten.leads.filter((l) => l.chats.length > 0);
const wartend = daten.leads.find((l) => l.wartet?.art === "antwort")!;
const beantwortet = mitChat.find((l) => !l.chats[0].kundeZuletzt)!;
const TAG = 24 * 60 * 60 * 1000;
const STUNDE = 60 * 60 * 1000;
const ms = (iso: string) => new Date(iso).getTime();

/**
 * Thread-Signale, wie laden.ts sie aus den Nachrichten bilden würde: Kunde zuletzt
 * heißt letzte eingehende = letzteNachrichtAm (vorher eine gesendete Antwort, außer
 * bei neuen Anfragen); sonst war unsere Antwort die letzte Nachricht.
 */
function signale(lead: LeadPunkt): ThreadSignal[] {
  return lead.chats.map((c: ChatKurz) => {
    const letzte = new Date(c.letzteNachrichtAm!);
    const nieBeantwortet = lead.status === "neu";
    return {
      id: c.id,
      kanal: c.kanal,
      status: c.status,
      lane: "lead",
      letzteEingehend: c.kundeZuletzt ? letzte : new Date(letzte.getTime() - 3 * STUNDE),
      letzteAusgehend: c.kundeZuletzt ? (nieBeantwortet ? null : new Date(letzte.getTime() - 20 * STUNDE)) : letzte,
      ersteEingehendNachAusgehend: c.kundeZuletzt ? letzte : null,
      ungelesen: c.ungelesen,
    };
  });
}

describe("beispielAntwort folgt den Regeln (S4)", () => {
  it("Wartet, Veraltet, E-Mail-ungelesen und alter Chat sind genau das, was wartetAuf aus den Chats ableitet", () => {
    for (const lead of daten.leads) {
      const erwartet = wartetAuf({ status: lead.status, angelegtAm: new Date(lead.angelegtAm), threads: signale(lead), jetzt });
      expect({ id: lead.id, wartet: lead.wartet, veraltet: lead.veraltet, emailUngelesen: lead.emailUngelesen, alterChat: lead.alterChat }).toEqual({
        id: lead.id,
        wartet: erwartet.wartet,
        veraltet: erwartet.veraltet,
        emailUngelesen: erwartet.emailUngelesen,
        alterChat: erwartet.alterOffenerChat,
      });
    }
  });

  it("kein Lead wartet auf Antwort in einem E-Mail-Thread", () => {
    const antwort = daten.leads.filter((l) => l.wartet?.art === "antwort");
    expect(antwort.length).toBeGreaterThanOrEqual(3);
    for (const l of antwort) {
      const chat = l.chats.find((c) => c.id === l.wartet!.chatId);
      expect(chat?.kanal).toBe("whatsapp");
      expect(chat?.kundeZuletzt).toBe(true);
      expect(jetzt.getTime() - ms(chat!.letzteNachrichtAm!)).toBeLessThanOrEqual(14 * TAG);
    }
  });

  it("neu_pruefen nur bei neuen Anfragen, jünger als 7 Tage, ohne Antwort", () => {
    const neu = daten.leads.filter((l) => l.wartet?.art === "neu_pruefen");
    expect(neu.length).toBeGreaterThan(0);
    for (const l of neu) {
      expect(l.status).toBe("neu");
      expect(jetzt.getTime() - ms(l.angelegtAm)).toBeLessThanOrEqual(7 * TAG);
      expect(l.chats.every((c) => c.kundeZuletzt)).toBe(true);
    }
    expect(daten.leads.some((l) => l.veraltet)).toBe(true);
  });

  it("mindestens ein alter Chat bei einem aktiven und einer nach „Verloren“, beide mit Mission „Chat aufräumen“", () => {
    const alt = daten.leads.filter((l) => l.alterChat);
    expect(alt.some((l) => l.status !== "verloren")).toBe(true);
    expect(alt.some((l) => l.status === "verloren")).toBe(true);
    for (const l of alt) {
      expect(daten.missionen.find((m) => m.leadId === l.id && m.art === "chat_aufraeumen")).toBeDefined();
    }
  });

  it("Missionen und Kennzahlen kommen aus denselben Regeln wie auf dem Server, jede Missionsart mindestens einmal", () => {
    expect(daten.missionen).toEqual(erzeugeMissionen(daten.leads, jetzt));
    expect(daten.kennzahlen).toEqual(berechneKennzahlen(daten.leads, jetzt));
    const ARTEN: MissionArt[] = [
      "kv_nachfassen",
      "termin_ohne_auftrag",
      "auftrag_stufe",
      "zahlung_offen",
      "adresse_fehlt",
      "stufe_pflegen",
      "wert_pruefen",
      "chat_aufraeumen",
    ];
    expect([...new Set(daten.missionen.map((m) => m.art))].sort()).toEqual([...ARTEN].sort());
  });

  it("gleich mit echter Uhrzeit (Vorschau nutzt new Date())", () => {
    const spaeter = new Date("2026-12-24T18:45:00+01:00");
    const d = beispielAntwort(spaeter);
    expect(new Set(d.missionen.map((m) => m.art)).size).toBe(8);
    expect(d.leads.filter((l) => l.wartet?.art === "antwort").length).toBe(daten.leads.filter((l) => l.wartet?.art === "antwort").length);
  });

  it("die Chat-Vorschau passt zu jedem Thread: gleicher Kanal, gleiche Richtung, ohne Antwort keine ausgehende Nachricht", () => {
    for (const lead of mitChat) {
      for (const kurz of lead.chats) {
        const v = beispielChatVorschau(kurz.id, jetzt);
        expect(v.chat).toEqual(kurz);
        expect(kundeSchriebZuletzt([...v.nachrichten].reverse().map((n) => ({ direction: n.richtung, status: n.status })))).toBe(kurz.kundeZuletzt);
        const letzte = v.nachrichten[v.nachrichten.length - 1];
        expect(letzte.zeit).toBe(kurz.letzteNachrichtAm);
        expect(kurz.vorschau).toBe(letzte.richtung === "outbound" ? `Du: ${letzte.text}` : letzte.text);
        if (lead.status === "neu") expect(v.nachrichten.every((n) => n.richtung === "inbound")).toBe(true);
      }
    }
  });
});

describe("beispielChatVorschau", () => {
  it("liefert 6 bis 8 Nachrichten, älteste zuerst, eine mit KV-Link", () => {
    for (const lead of [wartend, beantwortet]) {
      const chat = beispielChatVorschau(lead.chats[0].id, jetzt);
      expect(chat.nachrichten.length).toBeGreaterThanOrEqual(6);
      expect(chat.nachrichten.length).toBeLessThanOrEqual(8);
      const zeiten = chat.nachrichten.map((n) => new Date(n.zeit).getTime());
      expect([...zeiten].sort((a, b) => a - b)).toEqual(zeiten);
      expect(chat.nachrichten.filter((n) => /Kostenvoranschlag/.test(n.text) && /https:\/\//.test(n.text))).toHaveLength(1);
      expect(chat.mehr).toBe(false);
    }
  });

  it("passt zum Chat aus beispielAntwort: gleiche ID, Kunde zuletzt, letzte Nachricht = letzteNachrichtAm", () => {
    for (const lead of [wartend, beantwortet]) {
      const kurz = lead.chats[0];
      const chat = beispielChatVorschau(kurz.id, jetzt);
      expect(chat.chat).toEqual(kurz);
      const letzte = chat.nachrichten[chat.nachrichten.length - 1];
      expect(letzte.richtung).toBe(kurz.kundeZuletzt ? "inbound" : "outbound");
      expect(letzte.zeit).toBe(kurz.letzteNachrichtAm);
    }
  });

  it("eine Nachricht nur mit Fotos (wie die echte Vorschau: Text „2 Fotos“)", () => {
    const fotos = beispielChatVorschau(wartend.chats[0].id, jetzt).nachrichten.filter((n) => n.anhaenge > 0);
    expect(fotos).toEqual([expect.objectContaining({ anhaenge: 2, anhangArt: "foto", text: "2 Fotos", richtung: "inbound" })]);
  });

  it("Links zeigen nie auf echte Domains", () => {
    const texte = beispielChatVorschau(wartend.chats[0].id, jetzt).nachrichten.map((n) => n.text).join(" ");
    for (const url of texte.match(/https?:\/\/[^\s]+/g) ?? []) expect(new URL(url).hostname.endsWith(".invalid")).toBe(true);
  });

  it("unbekannte Chat-ID: trotzdem plausibler Chat (kein Fehler in der Vorschau)", () => {
    const chat = beispielChatVorschau("gibt-es-nicht", jetzt);
    expect(chat.chat.id).toBe("gibt-es-nicht");
    expect(chat.nachrichten.length).toBeGreaterThanOrEqual(6);
  });
});

describe("beispielVerlauf", () => {
  const SCHLUESSEL = ["erstkontakt", "infos_erhalten", "angebot", "angenommen", "umzugstermin", "bezahlt", "bewertung"];

  it("hat die Form von GET /api/v1/deals/{id}/lifecycle", () => {
    for (const lead of daten.leads) {
      const v = beispielVerlauf(lead.id, jetzt);
      expect(v.milestones.map((m) => m.key)).toEqual(SCHLUESSEL);
      for (const m of v.milestones) {
        expect(typeof m.label).toBe("string");
        expect(m.done ? m.at !== null : true).toBe(true);
      }
      expect(v.current).toBe(v.milestones.find((m) => !m.done)?.key ?? null);
      expect(v.milestones.find((m) => m.key === "bewertung")?.done).toBe(false);
    }
  });

  it("folgt dem Lead: Erstkontakt immer, Angebot nur mit KV, Annahme nur bei Auftrag", () => {
    const neu = daten.leads.find((l) => l.status === "neu")!;
    const auftrag = daten.leads.find((l) => l.status === "auftrag")!;
    const v1 = beispielVerlauf(neu.id, jetzt);
    expect(v1.milestones[0]).toMatchObject({ key: "erstkontakt", done: true, at: neu.angelegtAm });
    expect(v1.milestones.find((m) => m.key === "angebot")?.done).toBe(false);
    const v2 = beispielVerlauf(auftrag.id, jetzt);
    expect(v2.milestones.find((m) => m.key === "angebot")?.done).toBe(true);
    expect(v2.milestones.find((m) => m.key === "angenommen")).toMatchObject({ done: true, at: auftrag.kv.angenommenAm });
  });
});

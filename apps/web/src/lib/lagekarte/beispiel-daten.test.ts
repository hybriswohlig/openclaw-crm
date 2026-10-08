import { describe, expect, it } from "vitest";
import { beispielAntwort, beispielChatVorschau, beispielVerlauf } from "./beispiel-daten";

const jetzt = new Date("2026-10-08T07:30:00+02:00");
const daten = beispielAntwort(jetzt);
const mitChat = daten.leads.filter((l) => l.chats.length > 0);
const wartend = mitChat.find((l) => l.chats[0].kundeZuletzt)!;
const beantwortet = mitChat.find((l) => !l.chats[0].kundeZuletzt)!;

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

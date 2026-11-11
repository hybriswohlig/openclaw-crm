/**
 * „Im Chat senden“ nach dem KV (Auftrag kv-danach), Teil der Inbox: Kurztext
 * bauen und entscheiden, wohin er kommt. Nie senden: der Text landet im
 * Eingabefeld des Gesprächs oder im Verfassen-Fenster, den Rest macht ein Mensch.
 */
import { apiAufruf, jsonAufruf } from "@/components/neu/akte/api";
import { fensterZu, startFolge } from "@/components/neu/akte/gespraech-texte";
import { statusLinkHolen } from "@/components/neu/kv-danach/status-link";
import { verfassenAus, type VerfassenVorgabe } from "@/lib/handy-links";
import type { Kurzfassung } from "@/lib/inbox-neu";
import { kvFertigNachricht, kvPreisAus, type KvPreisAngebot, type KvPreisOption, type KvPreisTag, linkVerwaltenUrl, PORTAL_EINSTELLUNGEN_URL, statusLinkMeldung } from "@/lib/kv-danach";
import type { Gespraech } from "@/services/gespraech";
import { vornameAus } from "./inbox-logik";

export type KvWeg =
  /** Es gibt ein sendefähiges Gespräch: Text ins Eingabefeld (bei WABA außerhalb des Fensters gesperrt, dann Vorlage). */
  | { art: "einfuegen"; text: string; fensterZu: boolean }
  /** Noch kein Gespräch: das bestehende WhatsApp-Verfassen mit dem Text. */
  | { art: "verfassen"; text: string; vorgabe: VerfassenVorgabe }
  /** Das Gespräch gibt es, hing aber noch nicht am Deal: neu laden, genau dieses Gespräch wählen, dann einfügen. */
  | { art: "neu_laden"; text: string; gespraechId: string }
  /** `nachricht`: der fertige Kurztext, wenn nur das Gespräch fehlt (dann in die Zwischenablage). */
  | { art: "meldung"; titel: string; text?: string; ziel?: { label: string; href: string }; nachricht?: string };

/** Sendefähiges Gespräch und ob dort das 24-Stunden-Fenster zu ist (wie die Eingabe wählt: Vorauswahl). */
export function sendeZiel(g: Pick<Gespraech, "kanaele" | "vorauswahl">): { fensterZu: boolean } | null {
  const sendbar = g.kanaele.filter((k) => k.kannSenden);
  if (sendbar.length === 0) return null;
  const gewaehlt = sendbar.find((k) => k.gespraechId === g.vorauswahl) ?? sendbar[0];
  return { fensterZu: fensterZu(gewaehlt) };
}

export async function kvNachrichtWeg(dealId: string, kurzVorher: Kurzfassung | null, gespraech: Gespraech): Promise<KvWeg> {
  const deal = encodeURIComponent(dealId);
  const [link, angebot, optionen, tage, kurzNeu] = await Promise.all([
    statusLinkHolen(dealId),
    apiAufruf<KvPreisAngebot | null>(`/api/v1/deals/${deal}/quotation`),
    apiAufruf<{ options?: KvPreisOption[] } | null>(`/api/v1/deals/${deal}/package-options`),
    apiAufruf<{ offers?: KvPreisTag[] } | null>(`/api/v1/deals/${deal}/date-offers`),
    // Fehlt die Kurzfassung (Firma entscheidet du/Sie), noch einmal holen.
    kurzVorher ? Promise.resolve(null) : apiAufruf<Kurzfassung>(`/api/v1/deals/${deal}/kurzfassung`),
  ]);
  const kurz = kurzVorher ?? (kurzNeu?.ok ? kurzNeu.data : null);
  if (link.art !== "ok") {
    const m = statusLinkMeldung(link);
    const ziel =
      link.art === "gesperrt"
        ? { label: "Alte Akte öffnen", href: linkVerwaltenUrl(dealId) }
        : link.art === "portal_aus"
          ? { label: "Einstellungen", href: PORTAL_EINSTELLUNGEN_URL }
          : undefined;
    return { art: "meldung", titel: m.titel, text: m.text, ziel };
  }
  const text = kvFertigNachricht({
    firma: kurz?.kunde.firma ?? null,
    vorname: vornameAus(kurz?.name),
    preis: kvPreisAus(
      angebot.ok ? angebot.data : null,
      optionen.ok ? (optionen.data?.options ?? []) : [],
      tage.ok ? (tage.data?.offers ?? []) : []
    ),
    url: link.url,
    dealNumber: link.dealNumber,
  });

  const ziel = sendeZiel(gespraech);
  if (ziel) return { art: "einfuegen", text, fensterZu: ziel.fensterZu };

  // Kein sendefähiges Gespräch: derselbe Weg wie „WhatsApp starten“ in der Akte.
  const r = await apiAufruf<unknown>("/api/v1/inbox/whatsapp/start-from-record", jsonAufruf("POST", { recordId: dealId }));
  if (!r.ok) return { art: "meldung", titel: "WhatsApp konnte nicht gestartet werden.", text: r.message, nachricht: text };
  const folge = startFolge(r.data);
  if (folge.art === "verfassen") {
    const vorgabe = verfassenAus(new URL(folge.url, "http://x").searchParams);
    if (vorgabe) return { art: "verfassen", text, vorgabe };
  }
  if (folge.art === "neu_laden") return { art: "neu_laden", text, gespraechId: folge.conversationId };
  return { art: "meldung", titel: "WhatsApp konnte nicht gestartet werden.", text: "Unerwartete Antwort des Servers.", nachricht: text };
}

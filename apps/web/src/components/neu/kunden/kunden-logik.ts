/**
 * Reine Bausteine der Kundenseiten (Plan 11, Entscheidungen 13 und 14):
 * Ansichten, URL, Beträge, Daten, Inbox-Ziel eines Gesprächs.
 */
import { istKundenAnsicht } from "./kunden-ansicht";
import type { KundenAnsicht, KundenGespraech, KundenSuche } from "@/lib/bewertungen-kunden";

export { istKundenAnsicht };

export const ANSICHT_TITEL: Record<KundenAnsicht, string> = {
  kunden: "Kunden",
  anfragen: "Anfragen",
  ohne_kunde: "Deals ohne Kunde",
};

export const ANSICHT_LEER: Record<KundenAnsicht, string> = {
  kunden: "Noch keine Kunden mit angenommenem, durchgeführtem oder bezahltem Auftrag.",
  anfragen: "Keine offenen Anfragen.",
  ohne_kunde: "Alle Deals der letzten 12 Monate haben eine verknüpfte Person.",
};

export const SUCHE_TEXT: Record<KundenSuche["art"], string> = {
  leer: "",
  telefon: "Telefonnummer",
  dealnummer: "Deal-Nummer",
  email: "E-Mail",
  name: "Name",
};

/** `/app/kunden` mit `ansicht` (ohne Standard) und `q`. */
export function kundenUrl(ansicht: KundenAnsicht, q: string): string {
  const p = new URLSearchParams();
  if (ansicht !== "kunden") p.set("ansicht", ansicht);
  if (q.trim()) p.set("q", q.trim());
  const s = p.toString();
  return s ? `/app/kunden?${s}` : "/app/kunden";
}

export function apiUrl(ansicht: KundenAnsicht, q: string, weiter: string | null): string {
  const p = new URLSearchParams({ ansicht });
  if (q.trim()) p.set("q", q.trim());
  if (weiter) p.set("weiter", weiter);
  return `/api/v1/kunden?${p.toString()}`;
}

export function euro(cent: number | null): string {
  if (cent == null) return "unbekannt";
  const nachkomma = cent % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: nachkomma,
    maximumFractionDigits: nachkomma,
  }).format(cent / 100);
}

/** ISO-Datum oder -Zeit als „09.11.2026“ (Berlin). */
export function datum(iso: string | null): string | null {
  if (!iso) return null;
  const nurTag = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(nurTag ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Neue Inbox wie die Akte: Gespräch am Deal über den Deal, sonst das Gespräch selbst. */
export function gespraechZiel(g: Pick<KundenGespraech, "conversationId" | "dealId">): string {
  const key = g.dealId ? `deal:${g.dealId}` : `gespraech:${g.conversationId}`;
  return `/app/inbox?e=${encodeURIComponent(key)}`;
}

export const KANAL_TEXT: Record<KundenGespraech["kanal"], string> = {
  whatsapp: "WhatsApp",
  email: "E-Mail",
  sms: "SMS",
  andere: "Nachricht",
};

/** Kurzname der Firma für Chips: das Wort mit der Marke, sonst das erste Wort. */
export function firmaKurz(name: string): string {
  const w = name.trim().split(/\s+/);
  const mitMarke = w.find((x) => /kottke|ceylan/i.test(x));
  return mitMarke ?? w[0] ?? name;
}

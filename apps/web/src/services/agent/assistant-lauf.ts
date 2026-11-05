/**
 * Wann der Lead-Assistent (`lead.assistant.reply`) das LLM überhaupt aufrufen
 * darf. Rein, ohne DB: der Worker speichert das Ergebnis, diese Funktionen
 * entscheiden.
 *
 * Der Minutentakt hat dieselben Unterhaltungen immer wieder geschickt, weil
 * `no_op` und `handoff` nichts senden und der Stempel auf der Nachricht
 * (`ai_processed_at` über `created_at <= …`) die Zeile verfehlen kann. Danach
 * gilt die Unterhaltung wieder als unbeantwortet. Deshalb merkt sich der
 * Worker die letzte eingehende Kundennachricht (Id + Eingangszeit) und das
 * Ergebnis. Alle drei Ergebnisse (ask, handoff, no_op) sind erledigt.
 */

export const ASSISTENT_MINDESTABSTAND_MS = 60 * 60 * 1000;

export type AssistentAktion = "ask" | "handoff" | "no_op";

export interface AssistentCursor {
  inboundId: string | null;
  /** `created_at` der Kundennachricht, die der letzte Lauf abdeckt (ms). */
  inboundAt: number | null;
  action: AssistentAktion | null;
  /** Zeitpunkt des letzten LLM-Aufrufs (ms). Sicherheitsnetz, eine Stunde. */
  at: number | null;
}

export interface KundenNachrichtRef {
  id: string;
  direction: "inbound" | "outbound";
  /** Eingang im CRM (`created_at`), nicht der Date-Header. */
  createdAt: number;
}

export type AssistentEntscheidung =
  | { aufrufen: false; grund: "keine_nachricht" | "bereits_erledigt" | "stundenlimit" }
  | { aufrufen: true; grund: "neu" };

export function alsAssistentAktion(value: string | null | undefined): AssistentAktion | null {
  if (value === "ask" || value === "handoff" || value === "no_op") return value;
  return null;
}

/** Neueste eingehende Kundennachricht. Gleicher Eingang: höhere Id gewinnt. */
export function neuesteKundenNachricht(messages: KundenNachrichtRef[]): { id: string; at: number } | null {
  let best: { id: string; at: number } | null = null;
  for (const m of messages) {
    if (m.direction !== "inbound") continue;
    if (!best || m.createdAt > best.at || (m.createdAt === best.at && m.id > best.id)) {
      best = { id: m.id, at: m.createdAt };
    }
  }
  return best;
}

function istNeu(
  letzte: { id: string; at: number },
  cursor: AssistentCursor
): boolean {
  if (cursor.inboundId && letzte.id === cursor.inboundId) return false;
  if (cursor.inboundAt == null && !cursor.inboundId) return true;
  if (cursor.inboundAt == null) return true;
  return letzte.at > cursor.inboundAt;
}

/**
 * LLM nur bei einer neueren Kundennachricht, und höchstens einmal pro
 * Unterhaltung und Stunde. ask, handoff und no_op sind für diese Nachricht
 * erledigt. Das Stundenlimit gilt auch dann, wenn die Vergleichslogik eine
 * neue Nachricht meldet.
 */
export function sollAssistentLaufen(input: {
  letzteEingehende: { id: string; at: number } | null;
  cursor: AssistentCursor;
  jetzt: number;
}): AssistentEntscheidung {
  if (!input.letzteEingehende) return { aufrufen: false, grund: "keine_nachricht" };
  const neu = istNeu(input.letzteEingehende, input.cursor);
  if (!neu && input.cursor.action) return { aufrufen: false, grund: "bereits_erledigt" };
  if (
    input.cursor.at != null &&
    input.jetzt - input.cursor.at < ASSISTENT_MINDESTABSTAND_MS
  ) {
    return { aufrufen: false, grund: "stundenlimit" };
  }
  return { aufrufen: true, grund: "neu" };
}

export interface WerbungInput {
  channelType: string;
  fromAddr?: string | null;
  subject?: string | null;
  body?: string | null;
}

export interface WerbungUrteil {
  spam: boolean;
  reason: string;
}

const PORTAL_DOMAIN = [
  "moebeltransport24",
  "kleinanzeigen",
  "immobilienscout",
  "immoscout",
  "immowelt",
  "immonet",
  "check24",
  "movinga",
  "myhammer",
  "umzugsauktion",
  "umzug365",
  "aroundhome",
  "homeday",
  "quoka",
  "umzugsportal",
  "umzugsfirmen",
  "umzugsfirma",
  "blauarbeit",
  "preisvergleich",
];

const WERBE_DOMAIN = [
  "places.bing.com",
  "bingplaces",
  "business.google.com",
  "businessprofile.google.com",
  "accounts.google.com",
  "facebookmail.com",
];

/** noreply auf diesen Domains ist Systempost, keine Umzugsanfrage. */
const SYSTEM_ABSENDER_DOMAIN = ["microsoft.com", "google.com", "bing.com", "office.com", "office365.com"];

const LEAD_INHALT =
  /umzugs?anfrage|umzugsangebot|m(?:ö|oe)beltransport|wohnungsaufl(?:ö|oe)sung|umziehen|\bumzug|ziehe[n]?\s+um\b/i;

const BING_ODER_GOOGLE_BUSINESS =
  /bing\s+places|places\.bing|bingplaces|microsoft\s+advertising|google\s+(?:business\s+profile|my\s+business|unternehmensprofil)|unternehmensprofil\s+auf\s+google/i;

const WERBE_INHALT =
  /unsubscribe|abmelden|abmeldung|newsletter|list-unsubscribe|gewinnspiel|black\s+friday|rabattcode/i;

const SYSTEM_LOCAL =
  /^(mailer-daemon|postmaster|bounce|bounces|bounce-notification)$/i;

const NEWSLETTER_LOCAL = /^(newsletter|newsletters|marketing|promo|promotions)$/i;

const NOREPLY_LOCAL =
  /^(no[-_.]?reply|noreply\d*|donotreply|do-not-reply|do_not_reply|notifications?)$/i;

function normalisiere(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

function adresseAus(from: string): { local: string; domain: string } {
  const roh = from.trim();
  const gewinkelt = roh.match(/<([^>]+)>/);
  const email = (gewinkelt?.[1] ?? roh).trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 0) return { local: normalisiere(email), domain: "" };
  return {
    local: normalisiere(email.slice(0, at)),
    domain: normalisiere(email.slice(at + 1)),
  };
}

/**
 * Offensichtliche Werbung und Systempost, bevor das LLM läuft.
 * Konservativ: Umzugsportale (auch noreply@ von Möbeltransport24, ImmoScout,
 * Kleinanzeigen, …) und jeder Text, der nach einer Umzugsanfrage aussieht,
 * bleiben Leads. WhatsApp und SMS werden nie hier verworfen.
 */
export function istOffensichtlicheWerbung(input: WerbungInput): WerbungUrteil {
  if (input.channelType !== "email") return { spam: false, reason: "" };

  const from = input.fromAddr ?? "";
  const subject = input.subject ?? "";
  const body = (input.body ?? "").slice(0, 4000);
  const { local, domain } = adresseAus(from);
  const text = normalisiere(`${from}\n${subject}\n${body}`);
  const domainNorm = normalisiere(domain);

  if (domainNorm && PORTAL_DOMAIN.some((d) => domainNorm.includes(d))) {
    return { spam: false, reason: "" };
  }
  if (LEAD_INHALT.test(`${subject}\n${body}`) || LEAD_INHALT.test(text)) {
    return { spam: false, reason: "" };
  }

  if (domainNorm && WERBE_DOMAIN.some((d) => domainNorm.includes(normalisiere(d)))) {
    return { spam: true, reason: `werbeplattform:${domainNorm}` };
  }
  if (BING_ODER_GOOGLE_BUSINESS.test(`${from}\n${subject}\n${body}`) || BING_ODER_GOOGLE_BUSINESS.test(text)) {
    return { spam: true, reason: "bing_oder_google_business" };
  }
  if (SYSTEM_LOCAL.test(local)) return { spam: true, reason: `system:${local}` };
  if (NEWSLETTER_LOCAL.test(local)) return { spam: true, reason: `newsletter:${local}` };

  const systemDomain =
    domainNorm.length > 0 &&
    SYSTEM_ABSENDER_DOMAIN.some((d) => domainNorm === d || domainNorm.endsWith(`.${d}`));
  if (NOREPLY_LOCAL.test(local) && (systemDomain || WERBE_INHALT.test(`${subject}\n${body}`))) {
    return { spam: true, reason: `noreply:${domainNorm || local}` };
  }

  return { spam: false, reason: "" };
}

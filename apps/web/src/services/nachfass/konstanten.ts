/**
 * Nachfass-Bot, feste Grenzen aus der freigegebenen Lead-Logik (19.10.2026)
 * und den Entscheidungen des Inhabers. Keine Nachrichtentexte.
 */

export const NURI_GESPRAECH_ID = "03a7e3d4-7162-4021-ba75-c20d3e3ae112";
/** Ceylan-WhatsApp. Niemals Ziel, auch nicht als Ausweichkanal. */
export const CEYLAN_WA_PRAEFIX = "595a5e23";
export const KOTTKE_WA_PRAEFIX = "82027c02";
export const CEYLAN_MAIL = "ceylanoperations@gmail.com";

export const SIGNATUR_KOTTKE = "Dario von Kottke Umzüge";
export const SIGNATUR_CEYLAN = "Nuri von Ceylan Umzüge";

export const VERLUST_KEINE_RUECKMELDUNG = "keine Rückmeldung";

export const REGELN = ["a1", "a2", "a3", "b", "c", "legacy"] as const;
export type NachfassRegel = (typeof REGELN)[number];

/** Ab Angebots-Outbound: FU1 ab Tag 2, FU2 Tag 7, Abschluss Tag 10. */
export const FU1_NACH_MS = 2 * 24 * 60 * 60 * 1000;
export const FU2_NACH_MS = 7 * 24 * 60 * 60 * 1000;
export const ABSCHLUSS_NACH_MS = 10 * 24 * 60 * 60 * 1000;
export const INFO_FUER_TEAM_MS = 4 * 60 * 60 * 1000;
export const ANGEBOT_SPAET_MS = 48 * 60 * 60 * 1000;
export const TERMIN_NAH_MS = 48 * 60 * 60 * 1000;
export const ALT_NACH_MS = 14 * 24 * 60 * 60 * 1000;
export const ALT_ABSCHLUSS_NACH_MS = 3 * 24 * 60 * 60 * 1000;
export const TEAM_ABSTAND_MS = 24 * 60 * 60 * 1000;
export const TEAM_MAX = 3;

/** Automatische Kunden-Nachrichten. Entwürfe zählen nicht. */
export const KUNDEN_CAP_PRO_TAG = 20;
/** Altbestand: höchstens so viele Nachfass-Entwürfe pro Tag und Konto. */
export const ALT_BATCH_PRO_TAG = 15;
/** First-Contact bleibt getrennt; dieser Bot fasst ihn nicht an. */
export const ERSTKONTAKT_CAP = 30;

/** Saubere Freigaben, bevor ein Regel-Schalter überhaupt senden dürfte. */
export const SAUBERE_FREIGABEN_FUER_AUTOSEND = 20;

export const SEQUENZ_ID = "nachfass";

export const SEQUENZ_SCHRITT: Record<NachfassRegel | "legacy_abschluss", number> = {
  a1: 1,
  a2: 2,
  a3: 3,
  c: 4,
  legacy: 5,
  legacy_abschluss: 6,
  b: 7,
};

/**
 * Ziel der Nachricht. Das LLM formuliert frei, diese Sätze sind keine Vorlage
 * und werden nicht an den Kunden kopiert.
 */
export const ZIEL: Record<NachfassRegel | "legacy_abschluss", string> = {
  a1: "Kurz nachfragen, ob es Fragen zum Angebot gibt, und dass der Termin noch freigehalten wird.",
  a2: "Fragen, ob sich etwas ergeben hat. Ein kurzes Wort reicht. Wenn der Kunde absagt, den Termin streichen.",
  a3: "Den Termin freigeben und die Tür offen lassen. Kurz halten.",
  b: "Interne Erinnerung: die Infos sind vollständig, der Festpreis fehlt. Deal-Link nennen. Nichts an den Kunden.",
  c: "Einmal entschuldigen, dass das Angebot spät kam, und fragen, ob noch Bedarf besteht. Anbieten, das Angebot nachzureichen oder neu zu schicken.",
  legacy: "Einmal nachfassen wie bei der zweiten Erinnerung: ob sich etwas ergeben hat, ein kurzes Wort reicht, bei Absage den Termin streichen.",
  legacy_abschluss: "Den Termin freigeben und die Tür offen lassen. Kurz halten.",
};

export function istCeylanWhatsApp(kontoId: string | null | undefined): boolean {
  return (kontoId ?? "").toLowerCase().startsWith(CEYLAN_WA_PRAEFIX);
}

export function istNuriGespraech(gespraechId: string | null | undefined): boolean {
  return gespraechId === NURI_GESPRAECH_ID;
}

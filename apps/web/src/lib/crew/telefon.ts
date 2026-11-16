/**
 * Telefon und Sprache der Crew, ohne weitere Abhängigkeiten (auch im Browser
 * genutzt, etwa im Mitarbeiter-Panel).
 */
import { CREW_LOCALES, type CrewLocale } from "./contract";

export function istCrewLocale(x: unknown): x is CrewLocale {
  return typeof x === "string" && (CREW_LOCALES as readonly string[]).includes(x);
}

/** Anzeige der Sprachen im CRM (deutsch). */
export const CREW_LOCALE_TEXT: Record<CrewLocale, string> = {
  de: "Deutsch",
  en: "Englisch",
  tr: "Türkisch",
  ar: "Arabisch",
  pl: "Polnisch",
  uk: "Ukrainisch",
  ru: "Russisch",
};

/**
 * Telefon in E.164. Deutsche Nummern ohne Ländervorwahl (0151 …) werden +49;
 * „0049“ und „+49 (0) …“ werden bereinigt. Andere Länder nur mit „+“ oder
 * „00“. Ungültig → null.
 */
export function telefonE164(roh: string | null | undefined): string | null {
  if (typeof roh !== "string") return null;
  let s = roh.trim().replace(/\(0\)/g, "").replace(/[\s\-/().]/g, "");
  if (s === "") return null;
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  else if (s.startsWith("0")) s = `+49${s.slice(1)}`;
  if (!s.startsWith("+")) return null;
  if (s.startsWith("+490")) s = `+49${s.slice(4)}`;
  return /^\+[1-9]\d{6,14}$/.test(s) ? s : null;
}

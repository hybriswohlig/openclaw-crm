/**
 * WhatsApp-Text zum Briefing: kurz, persönlich, in der Sprache der Person, ohne
 * Firmennamen (der Absender zeigt die Firma). Der Tag steht in der Sprache der Person.
 */
import type { CrewLocale } from "./contract";
import { vorname } from "./link-nachricht";

const INTL: Record<CrewLocale, string> = { de: "de-DE", en: "en-GB", tr: "tr-TR", ar: "ar", pl: "pl-PL", uk: "uk-UA", ru: "ru-RU" };

const TEXTE: Record<CrewLocale, (name: string, tag: string, url: string) => string> = {
  de: (n, t, u) => `Hallo ${n}! Das Briefing für ${t} ist da. Bitte kurz lesen und „Gelesen“ tippen:\n${u}`,
  en: (n, t, u) => `Hi ${n}! The briefing for ${t} is ready. Please read it and tap "Read":\n${u}`,
  tr: (n, t, u) => `Merhaba ${n}! ${t} için brifing hazır. Lütfen oku ve “Okudum”a dokun:\n${u}`,
  ar: (n, t, u) => `مرحبًا ${n}! التعليمات ليوم ${t} جاهزة. من فضلك اقرأها واضغط «قرأت»:\n${u}`,
  pl: (n, t, u) => `Cześć ${n}! Briefing na ${t} jest gotowy. Przeczytaj go i kliknij „Przeczytane”:\n${u}`,
  uk: (n, t, u) => `Привіт, ${n}! Брифінг на ${t} готовий. Будь ласка, прочитай і натисни «Прочитано»:\n${u}`,
  ru: (n, t, u) => `Привет, ${n}! Брифинг на ${t} готов. Пожалуйста, прочитай и нажми «Прочитано»:\n${u}`,
};

/** "Do., 19.11." in der Sprache der Person; ohne Datum ein neutrales Wort. */
export function briefingTag(locale: CrewLocale, iso: string | null): string {
  const OHNE: Record<CrewLocale, string> = { de: "deinen Einsatz", en: "your job", tr: "işin", ar: "عملك", pl: "Twoje zlecenie", uk: "твою роботу", ru: "твой заказ" };
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return OHNE[locale];
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(INTL[locale], { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

export function briefingNachricht(locale: CrewLocale, name: string, tagIso: string | null, url: string): string {
  return (TEXTE[locale] ?? TEXTE.de)(vorname(name), briefingTag(locale, tagIso), url);
}

/** Persönlicher Link, der nach dem Anmelden direkt das Briefing öffnet. */
export function briefingUrl(linkUrl: string, dealId: string): string {
  return `${linkUrl}?b=${encodeURIComponent(dealId)}`;
}

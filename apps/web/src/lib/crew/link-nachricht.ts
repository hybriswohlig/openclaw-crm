/**
 * WhatsApp-Text, mit dem der Crew-Link verschickt wird: kurz, persönlich, in der
 * Sprache der Person. Keine Firmennamen im Text (der Absender zeigt die Firma).
 */
import type { CrewLocale } from "./contract";

const TEXTE: Record<CrewLocale, (name: string, url: string) => string> = {
  de: (n, u) => `Hallo ${n}! Hier ist dein persönlicher Link zu unseren Jobs:\n${u}\n\nEinfach antippen, kein Passwort nötig. Bitte nicht weitergeben, der Link gehört nur dir.`,
  en: (n, u) => `Hi ${n}! Here is your personal link to our jobs:\n${u}\n\nJust tap it, no password needed. Please don't share it, the link is only for you.`,
  tr: (n, u) => `Merhaba ${n}! İşlerimize giden kişisel bağlantın:\n${u}\n\nSadece dokun, şifre gerekmez. Lütfen kimseyle paylaşma, bu bağlantı sadece sana ait.`,
  ar: (n, u) => `مرحبًا ${n}! هذا رابطك الشخصي لأعمالنا:\n${u}\n\nاضغط عليه فقط، لا حاجة لكلمة مرور. من فضلك لا تشاركه، الرابط لك وحدك.`,
  pl: (n, u) => `Cześć ${n}! Oto Twój osobisty link do naszych zleceń:\n${u}\n\nWystarczy kliknąć, bez hasła. Nie przekazuj go dalej, link jest tylko dla Ciebie.`,
  uk: (n, u) => `Привіт, ${n}! Ось твоє особисте посилання на наші роботи:\n${u}\n\nПросто натисни, пароль не потрібен. Будь ласка, нікому не пересилай, посилання тільки для тебе.`,
  ru: (n, u) => `Привет, ${n}! Вот твоя личная ссылка на наши заказы:\n${u}\n\nПросто нажми, пароль не нужен. Пожалуйста, никому не пересылай, ссылка только для тебя.`,
};

/** Vorname = erstes Wort des Namens. */
export function vorname(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

export function crewLinkNachricht(locale: CrewLocale, name: string, url: string): string {
  return (TEXTE[locale] ?? TEXTE.de)(vorname(name), url);
}

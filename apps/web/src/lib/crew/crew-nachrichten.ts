/**
 * WhatsApp-Texte an die Crew (Absender: Rümpeltürken-Konto): „Du bist dabei“
 * nach der Zusage und die tägliche Sammelnachricht zu neuen Jobs. Kurz,
 * persönlich, in der Sprache der Person, ohne Firmennamen (der Absender zeigt
 * die Firma). Job-Arten wie im Portal.
 */
import { briefingTag } from "./briefing-nachricht";
import type { CrewJob, CrewLocale } from "./contract";
import { vorname } from "./link-nachricht";

const ART: Record<CrewLocale, Record<CrewJob["type"], string>> = {
  de: { move: "Umzug", clearance: "Entrümpelung", kitchen: "Küchenmontage", other: "Einsatz" },
  en: { move: "Move", clearance: "Clear-out", kitchen: "Kitchen fitting", other: "Job" },
  tr: { move: "Nakliyat", clearance: "Ev boşaltma", kitchen: "Mutfak montajı", other: "İş" },
  ar: { move: "نقل أثاث", clearance: "إفراغ منزل", kitchen: "تركيب مطبخ", other: "عمل" },
  pl: { move: "Przeprowadzka", clearance: "Opróżnianie", kitchen: "Montaż kuchni", other: "Zlecenie" },
  uk: { move: "Переїзд", clearance: "Вивіз мотлоху", kitchen: "Монтаж кухні", other: "Замовлення" },
  ru: { move: "Переезд", clearance: "Вывоз хлама", kitchen: "Монтаж кухни", other: "Заказ" },
};

const NICHT_FIX: Record<CrewLocale, string> = {
  de: "noch nicht fix",
  en: "not confirmed yet",
  tr: "henüz kesin değil",
  ar: "غير مؤكد بعد",
  pl: "jeszcze niepewne",
  uk: "ще не точно",
  ru: "ещё не точно",
};

export interface JobZeile {
  date: string;
  type: CrewJob["type"];
  town: string;
  fix: boolean;
}

/** "Do., 19.11. · Umzug · Nagold" (+ "noch nicht fix"). */
export function jobZeile(l: CrewLocale, j: JobZeile): string {
  const datum = /^\d{4}-\d{2}-\d{2}$/.test(j.date) ? briefingTag(l, j.date) : null;
  const teile = [datum, ART[l][j.type], j.town.trim() || null].filter(Boolean);
  return teile.join(" · ") + (j.fix ? "" : ` (${NICHT_FIX[l]})`);
}

const ZUSAGE: Record<CrewLocale, (n: string, job: string, u: string) => string> = {
  de: (n, j, u) => `Hallo ${n}! Du bist dabei: ${j}. Adresse und alle Infos findest du hier:\n${u}`,
  en: (n, j, u) => `Hi ${n}! You're in: ${j}. Address and all details here:\n${u}`,
  tr: (n, j, u) => `Merhaba ${n}! Ekiptesin: ${j}. Adres ve tüm bilgiler burada:\n${u}`,
  ar: (n, j, u) => `مرحبًا ${n}! أنت معنا: ${j}. العنوان وكل التفاصيل هنا:\n${u}`,
  pl: (n, j, u) => `Cześć ${n}! Jesteś w ekipie: ${j}. Adres i wszystkie informacje tutaj:\n${u}`,
  uk: (n, j, u) => `Привіт, ${n}! Ти в команді: ${j}. Адреса й усі деталі тут:\n${u}`,
  ru: (n, j, u) => `Привет, ${n}! Ты в команде: ${j}. Адрес и все детали здесь:\n${u}`,
};

export function zusageNachricht(l: CrewLocale, name: string, job: JobZeile, url: string): string {
  return (ZUSAGE[l] ?? ZUSAGE.de)(vorname(name), jobZeile(l, job), url);
}

const NEU: Record<CrewLocale, { kopf: (n: string, anzahl: number) => string; mehr: (k: number) => string; fuss: string }> = {
  de: { kopf: (n, a) => `Hallo ${n}! ${a === 1 ? "Ein neuer Job" : `${a} neue Jobs`} für dich:`, mehr: (k) => `und ${k} weitere`, fuss: "Sag einfach Ja oder Nein:" },
  en: { kopf: (n, a) => `Hi ${n}! ${a === 1 ? "A new job" : `${a} new jobs`} for you:`, mehr: (k) => `and ${k} more`, fuss: "Just say yes or no:" },
  tr: { kopf: (n, a) => `Merhaba ${n}! Senin için ${a === 1 ? "yeni bir iş" : `${a} yeni iş`} var:`, mehr: (k) => `ve ${k} iş daha`, fuss: "Evet ya da hayır de, yeter:" },
  ar: { kopf: (n, a) => `مرحبًا ${n}! ${a === 1 ? "عمل جديد" : `${a} أعمال جديدة`} لك:`, mehr: (k) => `و${k} أعمال أخرى`, fuss: "قل نعم أو لا فقط:" },
  pl: { kopf: (n, a) => `Cześć ${n}! ${a === 1 ? "Nowe zlecenie" : `Nowe zlecenia (${a})`} dla Ciebie:`, mehr: (k) => `i jeszcze ${k}`, fuss: "Po prostu powiedz tak lub nie:" },
  uk: { kopf: (n, a) => `Привіт, ${n}! ${a === 1 ? "Нове замовлення" : `Нові замовлення (${a})`} для тебе:`, mehr: (k) => `і ще ${k}`, fuss: "Просто скажи так чи ні:" },
  ru: { kopf: (n, a) => `Привет, ${n}! ${a === 1 ? "Новый заказ" : `Новые заказы (${a})`} для тебя:`, mehr: (k) => `и ещё ${k}`, fuss: "Просто скажи да или нет:" },
};

export const NEUE_JOBS_MAX_ZEILEN = 5;

export function neueJobsNachricht(l: CrewLocale, name: string, jobs: JobZeile[], url: string): string {
  const t = NEU[l] ?? NEU.de;
  const zeilen = jobs.slice(0, NEUE_JOBS_MAX_ZEILEN).map((j) => `• ${jobZeile(l, j)}`);
  if (jobs.length > NEUE_JOBS_MAX_ZEILEN) zeilen.push(`• ${t.mehr(jobs.length - NEUE_JOBS_MAX_ZEILEN)}`);
  return [t.kopf(vorname(name), jobs.length), ...zeilen, "", `${t.fuss}\n${url}`].join("\n");
}

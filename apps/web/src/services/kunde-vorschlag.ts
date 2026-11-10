/**
 * „Aus dem Chat übernehmen“: Vorschläge für Name, Telefon, E-Mail, Auszug und
 * Einzug aus den Gesprächen dieses Deals. Nichts wird gespeichert.
 *
 * Reihenfolge je Feld:
 * 1. frische KI-Auswertung des Chats (`extractDealInsights`, derselbe Prompt wie
 *    die KI-Analyse, ohne Übernahme ins Lead);
 * 2. die zuletzt gespeicherte KI-Auswertung (Ereignis `ai.insights_extracted`, Feld `adressen`);
 * 3. die Erkennung aus Plan 15 in den eingehenden Kundennachrichten (nur PLZ und Ort).
 * Jeder Wert läuft durch die Plan-15-Regeln (`vorschlagAdresse` usw.): Telefon-,
 * Kunden- und Rechnungsnummern, IBAN und Signaturen werden nie zur Adresse.
 * Mandantentrennung: alle Abfragen filtern auf Workspace und Deal.
 */
import { adressenAusNachrichten } from "@/lib/chat-adressen";
import {
  vorschlagAdresse,
  vorschlagEmail,
  vorschlagName,
  vorschlagTelefon,
  type AdressTeile,
  type KundeVorschlag,
} from "@/lib/deal-kunde";

export interface KiFelder {
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  move_from_address?: string | null;
  move_to_address?: string | null;
}

export interface VorschlagQuellen {
  /** Frische KI-Auswertung; null bei Fehler oder ohne Chat. */
  ki: (ws: string, deal: string) => Promise<KiFelder | null>;
  /** Letzte gespeicherte KI-Adressen. */
  kiGespeichert: (ws: string, deal: string) => Promise<{ von: string | null; nach: string | null } | null>;
  /** Eingehende Nachrichten, älteste zuerst. */
  texte: (ws: string, deal: string) => Promise<string[]>;
}

async function standardQuellen(): Promise<VorschlagQuellen> {
  const { extractDealInsights } = await import("@/services/deal-insights");
  const { kiAdressen, eingehendeTexte } = await import("@/services/chat-adressen");
  return {
    ki: async (ws, deal) => {
      // Vom Disponenten ausgelöst: interaktiv, nicht in die Hintergrund-Spur.
      const r = await extractDealInsights(ws, deal);
      return r.insights?.extracted ?? null;
    },
    kiGespeichert: kiAdressen,
    texte: eingehendeTexte,
  };
}

type Quelle = NonNullable<KundeVorschlag["quelle"]>;
const RANG: Record<Quelle, number> = { ki: 3, ki_gespeichert: 2, erkennung: 1 };

/** Erste brauchbare Adresse aus den Kandidaten (in Reihenfolge). */
function ersteAdresse(kandidaten: Array<[Quelle, string | null | undefined]>): { wert: AdressTeile; quelle: Quelle } | null {
  for (const [quelle, roh] of kandidaten) {
    const a = vorschlagAdresse(roh);
    if (a) return { wert: a, quelle };
  }
  return null;
}

export async function kundeVorschlag(ws: string, deal: string, quellen?: VorschlagQuellen): Promise<KundeVorschlag> {
  const q = quellen ?? (await standardQuellen());
  const sicher = async <T>(f: () => Promise<T>): Promise<T | null> => {
    try {
      return await f();
    } catch (err) {
      console.error("[kunde-vorschlag]", err);
      return null;
    }
  };

  const ki = await sicher(() => q.ki(ws, deal));
  const name = vorschlagName(ki?.customer_name);
  const email = vorschlagEmail(ki?.customer_email);
  const telefon = vorschlagTelefon(ki?.customer_phone);

  let auszug = ersteAdresse([["ki", ki?.move_from_address]]);
  let einzug = ersteAdresse([["ki", ki?.move_to_address]]);
  if (!auszug || !einzug) {
    const alt = await sicher(() => q.kiGespeichert(ws, deal));
    auszug ??= ersteAdresse([["ki_gespeichert", alt?.von]]);
    einzug ??= ersteAdresse([["ki_gespeichert", alt?.nach]]);
  }
  if (!auszug || !einzug) {
    const texte = (await sicher(() => q.texte(ws, deal))) ?? [];
    const erkannt = texte.length > 0 ? adressenAusNachrichten(texte) : { von: null, nach: null };
    auszug ??= ersteAdresse([["erkennung", erkannt.von]]);
    einzug ??= ersteAdresse([["erkennung", erkannt.nach]]);
  }

  const quellen_: Quelle[] = [
    ...(name || email || telefon ? (["ki"] as const) : []),
    ...(auszug ? [auszug.quelle] : []),
    ...(einzug ? [einzug.quelle] : []),
  ];
  const quelle = quellen_.sort((a, b) => RANG[b] - RANG[a])[0] ?? null;
  const nichts = !name && !email && !telefon && !auszug && !einzug;
  return {
    quelle,
    name,
    email,
    telefon,
    auszug: auszug?.wert ?? null,
    einzug: einzug?.wert ?? null,
    hinweis: nichts
      ? ki === null
        ? "Die KI-Auswertung hat nicht geklappt, und in den Nachrichten steht keine Adresse mit PLZ und Ort."
        : "Im Chat stehen weder Name noch Adresse noch E-Mail."
      : null,
  };
}

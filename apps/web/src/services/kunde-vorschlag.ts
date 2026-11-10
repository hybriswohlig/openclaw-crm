/**
 * „Aus dem Chat übernehmen“: Vorschläge für Name, Telefon, E-Mail, Auszug und
 * Einzug aus den Gesprächen dieses Deals. Nichts wird ins Lead gespeichert.
 *
 * Eingabe sind nur die eingehenden Kundennachrichten der Gespräche dieses Deals
 * (eigener Workspace), keine eigenen Antworten, Notizen oder Chats anderer Deals.
 *
 * KI sparsam (Review M1):
 * - eine frische Auswertung nur, wenn seit der letzten neue eingehende Nachrichten
 *   kamen; sonst die gespeicherte (Ereignis `deal.kunde_vorschlag`, still);
 * - je Deal höchstens eine Auswertung gleichzeitig (gleichzeitige Klicks teilen sie).
 *
 * Reihenfolge je Adresse: KI, sonst die letzte KI-Analyse (`ai.insights_extracted`,
 * Feld `adressen`), sonst die Erkennung aus Plan 15 (nur PLZ und Ort). Jeder Wert
 * läuft durch die Regeln in `lib/deal-kunde.ts`: Telefon-, Auftrags-, Kunden-,
 * Rechnungs- und Vorgangsnummern, IBAN und Signaturen werden nie zur Adresse.
 */
import { adressenAusNachrichten } from "@/lib/chat-adressen";
import { gleicheAdresse } from "@/lib/adresse";
import {
  ortAusTeilen,
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

export interface Eingang {
  /** Eingehende Nachrichten, älteste zuerst. */
  texte: string[];
  /** Stand der eingehenden Nachrichten („Anzahl:letzte ID“): ändert sich mit jeder neuen. */
  stand: string;
}

export interface VorschlagQuellen {
  eingang: (ws: string, deal: string) => Promise<Eingang>;
  /** Zuletzt gespeicherte Auswertung dieses Deals mit ihrem Nachrichtenstand. */
  gespeichert: (ws: string, deal: string) => Promise<{ stand: string; ki: KiFelder } | null>;
  speichern: (ws: string, deal: string, e: { stand: string; ki: KiFelder }) => Promise<void>;
  /** KI über die eingehenden Nachrichten; null bei Fehler. */
  ki: (ws: string, texte: string[]) => Promise<KiFelder | null>;
  /** Adressen der letzten allgemeinen KI-Analyse. */
  kiAnalyse: (ws: string, deal: string) => Promise<{ von: string | null; nach: string | null } | null>;
}

const VORSCHLAG_EVENT = "deal.kunde_vorschlag";
const NACHRICHTEN_MAX = 80;
const ZEICHEN_JE_NACHRICHT = 1500;
const ZEICHEN_GESAMT = 20_000;

/** Prompt-Eingabe: die neuesten eingehenden Nachrichten, gekürzt. */
export function kiEingabe(texte: string[]): string {
  const teile: string[] = [];
  let summe = 0;
  for (const t of [...texte].reverse().slice(0, NACHRICHTEN_MAX)) {
    const kurz = t.trim().slice(0, ZEICHEN_JE_NACHRICHT);
    if (!kurz) continue;
    if (summe + kurz.length > ZEICHEN_GESAMT) break;
    teile.unshift(kurz);
    summe += kurz.length;
  }
  return teile.map((t, i) => `[Nachricht ${i + 1}]\n${t}`).join("\n\n");
}

const SYSTEM = `Du liest Nachrichten, die ein Kunde an ein Umzugsunternehmen geschickt hat, und ziehst seine Kontaktdaten heraus.
Gib nur zurück, was der Kunde selbst schreibt. Erfinde nichts. Unklares ist null.
- customer_name: voller Name des Kunden (Vor- und Nachname), wenn er ihn nennt.
- customer_email, customer_phone: wie geschrieben.
- move_from_address: Adresse, aus der ausgezogen wird (Straße mit Hausnummer, PLZ, Ort).
- move_to_address: Adresse, in die eingezogen wird.
Telefonnummern, Kunden-, Auftrags-, Rechnungs- oder Vorgangsnummern und Signaturen sind nie eine Adresse.
Antworte nur mit dem JSON-Objekt.`;

export async function standardQuellen(): Promise<VorschlagQuellen> {
  // Nacheinander laden (gleichzeitige dynamische Importe umgehen in Tests die Modul-Mocks).
  const { db } = await import("@/db");
  const { activityEvents } = await import("@/db/schema");
  const { inboxConversations, inboxMessages } = await import("@/db/schema/inbox");
  const drizzle = await import("drizzle-orm");
  const { kiAdressen } = await import("@/services/chat-adressen");
  const { emitEvent } = await import("@/services/activity-events");
  const { and, desc, eq, sql } = drizzle;
  return {
    eingang: async (ws, deal) => {
      const zeilen = await db
        .select({ id: inboxMessages.id, body: inboxMessages.body })
        .from(inboxMessages)
        .innerJoin(inboxConversations, eq(inboxConversations.id, inboxMessages.conversationId))
        .where(
          and(
            eq(inboxMessages.workspaceId, ws),
            eq(inboxConversations.workspaceId, ws),
            eq(inboxConversations.dealRecordId, deal),
            eq(inboxMessages.direction, "inbound")
          )
        )
        .orderBy(desc(sql`coalesce(${inboxMessages.sentAt}, ${inboxMessages.createdAt})`), desc(inboxMessages.id))
        .limit(300);
      return { texte: zeilen.map((z) => z.body ?? "").reverse(), stand: `${zeilen.length}:${zeilen[0]?.id ?? "-"}` };
    },
    gespeichert: async (ws, deal) => {
      const [e] = await db
        .select({ payload: activityEvents.payload })
        .from(activityEvents)
        .where(and(eq(activityEvents.workspaceId, ws), eq(activityEvents.recordId, deal), eq(activityEvents.eventType, VORSCHLAG_EVENT)))
        .orderBy(desc(activityEvents.createdAt))
        .limit(1);
      const p = e?.payload as { stand?: unknown; ki?: unknown } | undefined;
      return p && typeof p.stand === "string" && p.ki && typeof p.ki === "object" ? { stand: p.stand, ki: p.ki as KiFelder } : null;
    },
    speichern: async (ws, deal, e) => {
      await emitEvent({
        workspaceId: ws,
        recordId: deal,
        objectSlug: "deals",
        eventType: VORSCHLAG_EVENT,
        payload: { silent: true, note: null, stand: e.stand, ki: e.ki },
        actorId: null,
      });
    },
    ki: async (ws, texte) => {
      const { z } = await import("zod");
      const { runAITask } = await import("@/services/ai/run-task");
      const { AI_TASK_SLUGS } = await import("@/services/ai/task-registry");
      const s = z.string().nullable().optional().default(null);
      const schema = z.object({ customer_name: s, customer_email: s, customer_phone: s, move_from_address: s, move_to_address: s });
      const r = await runAITask({
        workspaceId: ws,
        taskSlug: AI_TASK_SLUGS.DEAL_EXTRACT_INSIGHTS,
        system: SYSTEM,
        prompt: `# Eingehende Nachrichten des Kunden\n\n${kiEingabe(texte)}`,
        schema,
      });
      return r.ok ? r.output : null;
    },
    kiAnalyse: kiAdressen,
  };
}

/** Laufende KI-Auswertungen je Deal: gleichzeitige Klicks warten auf dieselbe. */
const laufend = new Map<string, Promise<KiFelder | null>>();

async function kiEinmal(q: VorschlagQuellen, ws: string, deal: string, eingang: Eingang): Promise<KiFelder | null> {
  const alt = await q.gespeichert(ws, deal);
  if (alt && alt.stand === eingang.stand) return alt.ki;
  const schluessel = `${ws}:${deal}:${eingang.stand}`;
  const schon = laufend.get(schluessel);
  if (schon) return schon;
  const lauf = (async () => {
    const ki = await q.ki(ws, eingang.texte);
    if (ki) await q.speichern(ws, deal, { stand: eingang.stand, ki });
    return ki;
  })();
  laufend.set(schluessel, lauf);
  try {
    return await lauf;
  } finally {
    laufend.delete(schluessel);
  }
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

  const eingang = (await sicher(() => q.eingang(ws, deal))) ?? { texte: [], stand: "0:-" };
  if (eingang.texte.every((t) => !t.trim())) {
    return {
      quelle: null,
      name: null,
      email: null,
      telefon: null,
      auszug: null,
      einzug: null,
      hinweis: "In diesem Deal gibt es noch keine Nachricht vom Kunden.",
    };
  }

  const ki = await sicher(() => kiEinmal(q, ws, deal, eingang));
  const name = vorschlagName(ki?.customer_name);
  const email = vorschlagEmail(ki?.customer_email);
  const telefon = vorschlagTelefon(ki?.customer_phone);

  let auszug = ersteAdresse([["ki", ki?.move_from_address]]);
  let einzug = ersteAdresse([["ki", ki?.move_to_address]]);
  if (!auszug || !einzug) {
    const alt = await sicher(() => q.kiAnalyse(ws, deal));
    auszug ??= ersteAdresse([["ki_gespeichert", alt?.von]]);
    einzug ??= ersteAdresse([["ki_gespeichert", alt?.nach]]);
  }
  if (!auszug || !einzug) {
    const erkannt = adressenAusNachrichten(eingang.texte);
    auszug ??= ersteAdresse([["erkennung", erkannt.von]]);
    einzug ??= ersteAdresse([["erkennung", erkannt.nach]]);
  }

  // KV-Meldung 10.11.: nennt der Kunde nur eine Adresse, setzt die KI sie gern auf beide Seiten.
  // Dann kein Einzug vorschlagen (nie still Auszug als Einzug).
  let einzugGleich = false;
  if (auszug && einzug && gleicheAdresse(ortAusTeilen(auszug.wert), ortAusTeilen(einzug.wert))) {
    einzug = null;
    einzugGleich = true;
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
    hinweis: einzugGleich
      ? "Im Chat steht für Auszug und Einzug dieselbe Adresse. Die Einzugsadresse bitte beim Kunden erfragen."
      : nichts
      ? ki === null
        ? "Die KI-Auswertung hat nicht geklappt, und in den Nachrichten steht keine Adresse mit PLZ und Ort."
        : "In den Nachrichten des Kunden stehen weder Name noch Adresse noch E-Mail."
      : null,
  };
}

/**
 * Rückfragen per WhatsApp an eine interne Nummer, gestellt von Werkzeugen
 * außerhalb des CRM (Quelle, zum Beispiel Kassensturz auf Darios Mac).
 *
 * 1. erstelleRueckfragen: Fragen mit Kurzcode anlegen und gebündelt in einer
 *    Nachricht an den Empfänger schicken (nachholen, wenn das Konto gerade
 *    nicht verbunden ist).
 * 2. listeRueckfragen: die Quelle holt Antworten ab (GET-Route).
 * 3. beantworteRueckfrage: Rückkanal aus verarbeiteInterneNachricht, wenn die
 *    Nachricht kein Freigabe-Befehl war. Nur der eingetragene Empfänger kann
 *    antworten.
 * Die Entscheidungen (Code, mehrdeutig, abgelaufen) liegen rein und getestet
 * in rueckfragen-befehle.ts; hier nur Datenbank und Versand.
 */
import { and, asc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { internRueckfragen, type RueckfrageStatus } from "@/db/schema/intern";
import { getSetting } from "@/services/workspace-settings";
import { sendeAnInterne } from "./intern-senden";
import { ladeInterneNummern } from "./interne-nummern";
import { antwortEntscheidung, mitNeuemCodeBeiKollision, neuerCode, rueckfrageNachricht, teileAnfrage, verpassteAntwort, type RueckfrageAnfrage } from "./rueckfragen-befehle";

export const RUECKFRAGEN_EMPFAENGER_KEY = "intern_rueckfragen_empfaenger";
const BEKANNT_TAGE = 60;
const MAX_LISTE = 200;
const TAG_MS = 86_400_000;

/** Fehler, die die Route als 400 meldet. */
export class RueckfrageFehler extends Error {}

export type Rueckfrage = {
  id: string;
  code: string;
  quelle: string;
  status: RueckfrageStatus;
  frage: string;
  optionen: string[];
  empfaenger: string;
  antwort: string | null;
  antwortVon: string | null;
  payload: Record<string, unknown> | null;
  expiresAt: Date;
  sentAt: Date | null;
  answeredAt: Date | null;
  createdAt: Date;
};

/** Einstellung intern_rueckfragen_empfaenger, sonst die erste interne Nummer. */
export async function standardEmpfaenger(workspaceId: string): Promise<string> {
  const nummern = await ladeInterneNummern(workspaceId);
  const gesetzt = (await getSetting(workspaceId, RUECKFRAGEN_EMPFAENGER_KEY))?.trim();
  if (gesetzt && nummern.some((nummer) => nummer.name === gesetzt)) return gesetzt;
  if (nummern[0]) return nummern[0].name;
  throw new RueckfrageFehler("kein Empfänger für Rückfragen (intern_whatsapp_nummern ist leer)");
}

export async function erstelleRueckfragen(
  workspaceId: string,
  anfrage: RueckfrageAnfrage,
  kontoId?: string | null,
  now = new Date()
): Promise<{ codes: string[]; zugestellt: boolean }> {
  let empfaenger: string;
  if (anfrage.empfaenger) {
    const nummern = await ladeInterneNummern(workspaceId);
    if (!nummern.some((nummer) => nummer.name === anfrage.empfaenger)) throw new RueckfrageFehler(`${anfrage.empfaenger} ist keine interne Nummer`);
    empfaenger = anfrage.empfaenger;
  } else {
    empfaenger = await standardEmpfaenger(workspaceId);
  }
  // Codes der letzten Wochen nicht wiederverwenden, damit eine späte Antwort nie die falsche Frage trifft.
  const ladeVergeben = async () =>
    new Set(
      (
        await db
          .select({ code: internRueckfragen.code })
          .from(internRueckfragen)
          .where(and(eq(internRueckfragen.workspaceId, workspaceId), gte(internRueckfragen.createdAt, new Date(now.getTime() - BEKANNT_TAGE * TAG_MS))))
      ).map((row) => row.code)
    );
  // Schon offene Fragen derselben Quelle zur selben Buchung behalten ihren Code und gehen nicht noch einmal raus.
  const txIds = anfrage.fragen.map((frage) => frage.payload?.tx_id).filter((id): id is string => typeof id === "string");
  const vorhanden = new Map<string, string>();
  if (txIds.length > 0) {
    const offen = await db
      .select({ code: internRueckfragen.code, txId: sql<string>`${internRueckfragen.payload}->>'tx_id'` })
      .from(internRueckfragen)
      .where(
        and(
          eq(internRueckfragen.workspaceId, workspaceId),
          eq(internRueckfragen.quelle, anfrage.quelle),
          eq(internRueckfragen.status, "offen"),
          inArray(sql<string>`${internRueckfragen.payload}->>'tx_id'`, txIds)
        )
      );
    for (const row of offen) if (row.txId) vorhanden.set(row.txId, row.code);
  }
  const { codes, neu } = teileAnfrage(anfrage.fragen, vorhanden);
  if (neu.length === 0) return { codes: codes as string[], zugestellt: true };
  // Zwei gleichzeitige Anfragen können denselben Code ziehen; der Unique-Index fängt das, dann neue Codes.
  const { zeilen, ids } = await mitNeuemCodeBeiKollision(async () => {
    const vergeben = await ladeVergeben();
    const zeilen = neu.map((index) => anfrage.fragen[index]!).map((frage) => {
      const code = neuerCode(vergeben);
      vergeben.add(code);
      return {
        workspaceId,
        quelle: anfrage.quelle,
        code,
        frage: frage.frage,
        optionen: frage.optionen,
        empfaenger,
        status: "offen" as const,
        payload: frage.payload ?? null,
        expiresAt: new Date(now.getTime() + frage.ablaufTage * TAG_MS),
        createdAt: now,
      };
    });
    const ids = (await db.insert(internRueckfragen).values(zeilen).returning({ id: internRueckfragen.id })).map((row) => row.id);
    return { zeilen, ids };
  });
  neu.forEach((index, position) => {
    codes[index] = zeilen[position]!.code;
  });
  const text = rueckfrageNachricht(anfrage.quelle, zeilen);
  const ergebnis = await sendeAnInterne(workspaceId, text, { kontoId, nurAn: [empfaenger], nachholen: true });
  // Zugestellt oder vorgemerkt: beides zählt als gesendet, das CRM holt nach.
  await db.update(internRueckfragen).set({ sentAt: now }).where(inArray(internRueckfragen.id, ids));
  return { codes: codes as string[], zugestellt: ergebnis.zugestellt.includes(empfaenger) };
}

export async function markiereAbgelaufen(workspaceId: string, now = new Date()): Promise<number> {
  const rows = await db
    .update(internRueckfragen)
    .set({ status: "abgelaufen" })
    .where(and(eq(internRueckfragen.workspaceId, workspaceId), eq(internRueckfragen.status, "offen"), lt(internRueckfragen.expiresAt, now)))
    .returning({ id: internRueckfragen.id });
  return rows.length;
}

export async function listeRueckfragen(
  workspaceId: string,
  opts: { quelle: string; status: RueckfrageStatus; seit?: Date | null },
  now = new Date()
): Promise<Rueckfrage[]> {
  await markiereAbgelaufen(workspaceId, now);
  const zeit = opts.status === "beantwortet" ? internRueckfragen.answeredAt : internRueckfragen.createdAt;
  const bedingungen = [eq(internRueckfragen.workspaceId, workspaceId), eq(internRueckfragen.quelle, opts.quelle), eq(internRueckfragen.status, opts.status)];
  if (opts.seit) bedingungen.push(gte(zeit, opts.seit));
  const rows = await db
    .select()
    .from(internRueckfragen)
    .where(and(...bedingungen))
    .orderBy(asc(zeit), asc(internRueckfragen.code))
    .limit(MAX_LISTE);
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    quelle: row.quelle,
    status: row.status,
    frage: row.frage,
    optionen: row.optionen ?? [],
    empfaenger: row.empfaenger,
    antwort: row.antwort,
    antwortVon: row.antwortVon,
    payload: row.payload ?? null,
    expiresAt: row.expiresAt,
    sentAt: row.sentAt,
    answeredAt: row.answeredAt,
    createdAt: row.createdAt,
  }));
}

/**
 * Antwort des Empfängers auf eine Rückfrage. Liefert den Text für die kurze
 * Bestätigung oder null, wenn die Nachricht keine Antwort war (dann wird sie
 * wie bisher verworfen).
 */
export async function beantworteRueckfrage(workspaceId: string, absenderName: string, text: string, now = new Date()): Promise<string | null> {
  await markiereAbgelaufen(workspaceId, now);
  const eigene = and(eq(internRueckfragen.workspaceId, workspaceId), eq(internRueckfragen.empfaenger, absenderName));
  const offene = await db
    .select({ id: internRueckfragen.id, code: internRueckfragen.code })
    .from(internRueckfragen)
    .where(and(eigene, eq(internRueckfragen.status, "offen")))
    .orderBy(asc(internRueckfragen.createdAt));
  const bekannte = await db
    .select({ code: internRueckfragen.code, status: internRueckfragen.status })
    .from(internRueckfragen)
    .where(and(eigene, ne(internRueckfragen.status, "offen"), gte(internRueckfragen.createdAt, new Date(now.getTime() - BEKANNT_TAGE * TAG_MS))));
  const entscheidungen = antwortEntscheidung(text, offene, bekannte);
  if (entscheidungen.length === 0) return null;
  const notiert: string[] = [];
  const meldungen: string[] = [];
  for (const entscheidung of entscheidungen) {
    if (entscheidung.aktion === "melden") {
      meldungen.push(entscheidung.text);
      continue;
    }
    const gespeichert = await db
      .update(internRueckfragen)
      .set({ status: "beantwortet", antwort: entscheidung.antwort, antwortVon: absenderName, answeredAt: now })
      .where(and(eq(internRueckfragen.id, entscheidung.id), eq(internRueckfragen.status, "offen")))
      .returning({ id: internRueckfragen.id });
    if (gespeichert.length > 0) {
      notiert.push(`#${entscheidung.code}`);
      continue;
    }
    // Inzwischen beantwortet oder abgelaufen: den echten Zustand melden.
    const [jetzt] = await db.select({ status: internRueckfragen.status }).from(internRueckfragen).where(eq(internRueckfragen.id, entscheidung.id));
    meldungen.push(verpassteAntwort(entscheidung.code, jetzt?.status ?? "beantwortet"));
  }
  const danke = notiert.length ? [`Danke, ${notiert.join(notiert.length === 2 ? " und " : ", ")} notiert.`] : [];
  return [...danke, ...meldungen].join("\n");
}

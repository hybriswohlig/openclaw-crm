/**
 * „Ich habe bezahlt“ mit einem Klick bestätigen oder verwerfen (Entscheidung 6).
 * Bestätigen schreibt in einer Transaktion die Zahlungszeile und
 * `payment.meldung_bestaetigt`; je Deal und Variante serialisiert eine
 * Advisory-Sperre, damit zwei gleichzeitige Klicks nur eine Zahlung schreiben.
 * Die Route prüft den Deal im Workspace; jede Suche filtert zusätzlich auf
 * Workspace und Deal, eine fremde eventId ergibt NICHT_GEFUNDEN.
 */
import { db } from "@/db";
import { activityEvents } from "@/db/schema/activity";
import { and, eq, inArray, sql } from "drizzle-orm";
import { berlinDateString } from "@/lib/berlin-date";
import {
  MELDUNG_BESTAETIGT,
  MELDUNG_EREIGNISTYPEN,
  MELDUNG_GEMELDET,
  MELDUNG_VERWORFEN,
  offeneMeldungen,
  type Zahlungsmeldung,
} from "@/lib/zahlungsmeldungen";
import type { ActivityEventType } from "./activity-events";
import { maybeNotifyDepositReceived } from "./customer-portal-notifications";
import { createPayment, resolveDealOperatingCompany } from "./financial";
import { nachZahlung } from "./nach-zahlung";
import { aktualisiereWartet } from "./wartet";
import { dealNumbers } from "@/db/schema/financial";
import { attributes, objects } from "@/db/schema/objects";
import { recordValues } from "@/db/schema/records";
import { MELDUNG_ALARM, meldungsAlarmFaellig, meldungsAlarmText } from "@/lib/geld";
import { sendeAnInterne } from "./intern/intern-senden";
import { erinnerungenStoppen } from "./rechnungen";

export type { Zahlungsmeldung } from "@/lib/zahlungsmeldungen";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Leser = typeof db | Tx;

export class ZahlungsmeldungFehler extends Error {
  constructor(
    public readonly code: "NICHT_GEFUNDEN" | "ERLEDIGT",
    message: string,
  ) {
    super(message);
    this.name = "ZahlungsmeldungFehler";
  }
}

const SPALTEN = {
  id: activityEvents.id,
  eventType: activityEvents.eventType,
  payload: activityEvents.payload,
  createdAt: activityEvents.createdAt,
};

/** Alle Meldungen und Folgeereignisse des Deals, ohne Limit (ältere Meldungen dürfen nicht herausfallen). */
function ladeEreignisse(leser: Leser, workspaceId: string, dealRecordId: string) {
  return leser
    .select(SPALTEN)
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.workspaceId, workspaceId),
        eq(activityEvents.recordId, dealRecordId),
        inArray(activityEvents.eventType, [...MELDUNG_EREIGNISTYPEN]),
      ),
    );
}

export async function ladeZahlungsmeldungen(workspaceId: string, dealRecordId: string): Promise<Zahlungsmeldung[]> {
  return offeneMeldungen(await ladeEreignisse(db, workspaceId, dealRecordId));
}

/**
 * Meldung laden, je Deal und Variante sperren, unter der Sperre neu prüfen,
 * dann `schreiben` in derselben Transaktion. Liefert das Ergebnis nach dem Commit.
 */
async function abschliessen<T>(
  workspaceId: string,
  dealRecordId: string,
  eventId: string,
  userId: string,
  folgeTyp: ActivityEventType,
  schreiben: (tx: Tx, meldung: Zahlungsmeldung) => Promise<{ ergebnis: T; payload: Record<string, unknown> }>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const [roh] = await tx
      .select(SPALTEN)
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.id, eventId),
          eq(activityEvents.workspaceId, workspaceId),
          eq(activityEvents.recordId, dealRecordId),
          eq(activityEvents.eventType, MELDUNG_GEMELDET),
        ),
      )
      .limit(1);
    const gelesen = roh ? offeneMeldungen([roh])[0] : undefined;
    if (!gelesen) throw new ZahlungsmeldungFehler("NICHT_GEFUNDEN", "Zahlungsmeldung nicht gefunden.");

    // Die Variante steht erst nach dem Laden fest; die Meldung selbst ändert sich nie.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('zahlungsmeldung:' || ${dealRecordId}::text || ':' || ${gelesen.variante}::text))`,
    );
    // Die Neuprüfung muss eine eigene Abfrage nach der Sperre bleiben. Sie verlässt sich auf
    // READ COMMITTED: der Commit der vorigen Bestätigung ist sichtbar, bevor ihre Sperre frei wird.
    // Unter REPEATABLE READ/SERIALIZABLE oder zusammen mit der Sperre in einer Abfrage sähe sie
    // den alten Stand, und zwei Klicks schrieben zwei Zahlungen.
    const offen = offeneMeldungen(await ladeEreignisse(tx, workspaceId, dealRecordId)).find(
      (m) => m.eventId === eventId,
    );
    if (!offen) throw new ZahlungsmeldungFehler("ERLEDIGT", "Zahlungsmeldung ist schon erledigt.");

    const { ergebnis, payload } = await schreiben(tx, offen);
    await tx.insert(activityEvents).values({
      workspaceId,
      recordId: dealRecordId,
      objectSlug: "deals",
      eventType: folgeTyp,
      payload: { eventId, ...payload, variante: offen.variante },
      actorId: userId,
    });
    return ergebnis;
  });
}

export async function bestaetigeZahlungsmeldung(
  workspaceId: string,
  dealRecordId: string,
  eventId: string,
  userId: string,
): Promise<{ paymentId: string }> {
  // Vor der Transaktion: createPayment soll unter der Sperre keine zweite Verbindung aus dem Pool ziehen.
  const operatingCompanyId = await resolveDealOperatingCompany(workspaceId, dealRecordId);
  const r = await abschliessen(workspaceId, dealRecordId, eventId, userId, MELDUNG_BESTAETIGT, async (tx, m) => {
    const zahlung = await createPayment(
      workspaceId,
      dealRecordId,
      {
        date: berlinDateString(),
        amount: (m.betragCent / 100).toFixed(2),
        paymentMethod: m.zahlungsart ?? undefined,
        notes: "Kunde meldete „bezahlt“ im Link",
        taxTreatment: "betriebseinnahme",
        operatingCompanyId,
        quelle: "meldung",
        createdBy: userId,
      },
      tx,
    );
    return { ergebnis: { paymentId: zahlung.id }, payload: { paymentId: zahlung.id } };
  });

  // Nach dem Commit, wie beim normalen Speichern einer Zahlung. Nie die Bestätigung brechen.
  try {
    await aktualisiereWartet(workspaceId, dealRecordId);
  } catch (err) {
    console.error("[wartet] nach Zahlungsmeldung fehlgeschlagen:", err);
  }
  void maybeNotifyDepositReceived({ workspaceId, dealRecordId }).catch(() => {});
  try {
    await nachZahlung(workspaceId, dealRecordId, userId);
  } catch (err) {
    console.error("[nach-zahlung] nach Zahlungsmeldung fehlgeschlagen:", err);
  }
  return r;
}

export async function verwerfeZahlungsmeldung(
  workspaceId: string,
  dealRecordId: string,
  eventId: string,
  userId: string,
): Promise<void> {
  await abschliessen(workspaceId, dealRecordId, eventId, userId, MELDUNG_VERWORFEN, async () => ({
    ergebnis: undefined,
    payload: {},
  }));
}

/**
 * Alarm „Kunde meldet bezahlt“ (Plan 9, G7): genau eine WhatsApp an beide
 * Inhaber je Meldung. Unter `pg_advisory_xact_lock` je Deal und Variante prüft
 * `meldungsAlarmFaellig`, ob seit der letzten Erledigung schon ein Alarm liegt;
 * nur sonst wird `payment.meldung_alarm` geschrieben und nach dem Commit
 * gesendet. Wiederholtes Tippen schickt nichts mehr. Liefert, ob gesendet wurde.
 */
export async function meldungsAlarm(ws: string, deal: string, eventId: string): Promise<boolean> {
  const [meldung] = await db
    .select(SPALTEN)
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.id, eventId),
        eq(activityEvents.workspaceId, ws),
        eq(activityEvents.recordId, deal),
        eq(activityEvents.eventType, MELDUNG_GEMELDET),
      ),
    )
    .limit(1);
  const variante = (meldung?.payload as { variant?: unknown } | null)?.variant;
  if (!meldung || (variante !== "deposit" && variante !== "final")) return false;
  const betragCent = Number((meldung.payload as { amountCents?: unknown }).amountCents) || 0;

  const faellig = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('zahlungsmeldung-alarm:' || ${deal}::text || ':' || ${variante}::text))`,
    );
    // Eigene Abfrage nach der Sperre (READ COMMITTED): der Alarm des Vorgängers ist sichtbar.
    const ereignisse = await tx
      .select(SPALTEN)
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.workspaceId, ws),
          eq(activityEvents.recordId, deal),
          inArray(activityEvents.eventType, [...MELDUNG_EREIGNISTYPEN, MELDUNG_ALARM]),
        ),
      );
    if (!meldungsAlarmFaellig(ereignisse, eventId)) return false;
    await tx.insert(activityEvents).values({
      workspaceId: ws,
      recordId: deal,
      objectSlug: "deals",
      eventType: MELDUNG_ALARM,
      payload: { eventId, variante, betragCent },
    });
    return true;
  });
  if (!faellig) return false;

  const [nummer, name] = await Promise.all([
    db.select({ n: dealNumbers.dealNumber }).from(dealNumbers).where(eq(dealNumbers.dealRecordId, deal)).limit(1),
    db
      .select({ t: recordValues.textValue })
      .from(recordValues)
      .innerJoin(attributes, eq(attributes.id, recordValues.attributeId))
      .innerJoin(objects, eq(objects.id, attributes.objectId))
      .where(and(eq(recordValues.recordId, deal), eq(attributes.slug, "name"), eq(objects.workspaceId, ws)))
      .limit(1),
  ]);
  const text = meldungsAlarmText({
    name: name[0]?.t?.trim() || "Kunde",
    nummer: nummer[0]?.n ?? null,
    betragCent,
    variante,
  });
  try {
    await sendeAnInterne(ws, text, { nachholen: true });
  } catch (err) {
    console.error("[zahlungsmeldung] Alarm senden fehlgeschlagen:", err);
  }
  return true;
}

/** Nach einer neuen Meldung (öffentlicher Link): Alarm und Erinnerungen stoppen. Fehler brechen nie. */
export async function nachMeldung(ws: string, deal: string): Promise<void> {
  try {
    const [neueste] = await db
      .select({ id: activityEvents.id })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.workspaceId, ws),
          eq(activityEvents.recordId, deal),
          eq(activityEvents.eventType, MELDUNG_GEMELDET),
        ),
      )
      .orderBy(sql`${activityEvents.createdAt} desc`)
      .limit(1);
    if (neueste) await meldungsAlarm(ws, deal, neueste.id);
  } catch (err) {
    console.error("[zahlungsmeldung] Alarm fehlgeschlagen:", err);
  }
  await erinnerungenStoppen(ws, deal, "meldung").catch(() => {});
}

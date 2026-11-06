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
import { createPayment } from "./financial";
import { nachZahlung } from "./nach-zahlung";
import { aktualisiereWartet } from "./wartet";

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

/**
 * Täglicher Lauf „Zahlungserinnerung“. Legt Entwürfe an und versendet nichts.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { agentDrafts } from "@/db/schema/agent";
import { activityEvents } from "@/db/schema/activity";
import { dealInvoices, paymentReminders } from "@/db/schema/deal-invoices";
import { companySettings } from "@/db/schema/company-settings";
import { payments } from "@/db/schema/financial";
import { inboxConversations } from "@/db/schema/inbox";
import { nachfassDailySends } from "@/db/schema/nachfass";
import { workspaces } from "@/db/schema/workspace";
import {
  berlinTag,
  erinnerungBetreff,
  erinnerungFaellig,
  erinnerungSchluessel,
  erinnerungText,
  ERINNERUNG_QUELLE,
  euro,
  offenAus,
  type ErinnerungGrund,
  type ErinnerungKandidat,
  type ErinnerungLauf,
  type RechnungStatus,
} from "@/lib/geld";
import { MELDUNG_EREIGNISTYPEN, offeneMeldungen } from "@/lib/zahlungsmeldungen";
import { createAgentDraft } from "@/services/agent/agent-drafts";
import { imKundenfenster, kundenCapErreicht } from "@/services/nachfass/logik";
import { ladeKandidaten } from "./auswahl";

const FRIST_MS = 240_000;

/** Entwurf wurde verschickt. `auto_sent` ist der automatische Versand. */
const DRAFT_GESENDET = new Set(["sent", "auto_sent"]);

/**
 * Entwurf ist tot. `dismissed` ist die Ablehnung in `agent_drafts`
 * (ein Status `rejected` gibt es nicht).
 */
const DRAFT_VERWORFEN = new Set(["dismissed", "rejected", "superseded", "cancelled", "gate_blocked"]);

export async function runZahlungserinnerung(jetzt: Date = new Date()): Promise<ErinnerungLauf> {
  const summary = leer();
  if (!imKundenfenster(jetzt)) return summary;

  const deadline = Date.now() + FRIST_MS;
  const wsRows = await db.select({ id: workspaces.id }).from(workspaces);
  for (const ws of wsRows) {
    if (Date.now() > deadline) break;
    summary.workspaces += 1;
    try {
      await laufFuerWorkspace(ws.id, jetzt, deadline, summary);
    } catch (err) {
      console.error("[zahlungserinnerung] workspace failed:", ws.id, err);
      summary.fehler += 1;
    }
  }
  return summary;
}

async function laufFuerWorkspace(ws: string, jetzt: Date, deadline: number, summary: ErinnerungLauf): Promise<void> {
  await syncEntwuerfe(ws);
  await stoppeErledigte(ws, summary);
  const kandidaten = await ladeKandidaten(ws, jetzt);
  for (const kandidat of kandidaten) {
    if (Date.now() > deadline) break;
    summary.geprueft += 1;
    try {
      await bearbeite(kandidat, jetzt, summary);
    } catch (err) {
      console.error("[zahlungserinnerung] rechnung failed:", kandidat.invoiceId, err);
      summary.fehler += 1;
    }
  }
}

async function syncEntwuerfe(ws: string): Promise<void> {
  const rows = await db
    .select({
      reminderId: paymentReminders.id,
      draftId: agentDrafts.id,
      draftStatus: agentDrafts.status,
      expiresAt: agentDrafts.expiresAt,
      idempotencyKey: agentDrafts.idempotencyKey,
      reviewedAt: agentDrafts.reviewedAt,
      updatedAt: agentDrafts.updatedAt,
    })
    .from(agentDrafts)
    .innerJoin(paymentReminders, eq(paymentReminders.draftId, agentDrafts.id))
    .where(and(eq(paymentReminders.workspaceId, ws), eq(paymentReminders.status, "entwurf"), eq(agentDrafts.workspaceId, ws)));

  for (const row of rows) {
    const jetzt = new Date();
    // Fix-Welle M7: ein Entwurf, den niemand rechtzeitig freigegeben hat (abgelaufen
    // oder noch „pending“ nach Ablauf), beendet die Kette nicht: die Erinnerungszeile
    // fällt weg und der nächste Lauf legt einen frischen Entwurf an.
    const abgelaufen =
      row.draftStatus === "expired" ||
      (row.draftStatus === "pending" && row.expiresAt != null && row.expiresAt.getTime() < jetzt.getTime());
    if (abgelaufen) {
      await db
        .update(agentDrafts)
        .set({
          status: "expired",
          idempotencyKey: row.idempotencyKey ? `${row.idempotencyKey}:abgelaufen:${row.draftId}` : null,
          updatedAt: jetzt,
        })
        .where(and(eq(agentDrafts.id, row.draftId), eq(agentDrafts.workspaceId, ws)));
      await db
        .delete(paymentReminders)
        .where(and(eq(paymentReminders.id, row.reminderId), eq(paymentReminders.workspaceId, ws), eq(paymentReminders.status, "entwurf")));
      continue;
    }
    if (DRAFT_GESENDET.has(row.draftStatus)) {
      await db
        .update(paymentReminders)
        .set({
          status: "gesendet",
          gesendetAm: row.reviewedAt ?? row.updatedAt,
          updatedAt: jetzt,
        })
        .where(and(eq(paymentReminders.id, row.reminderId), eq(paymentReminders.workspaceId, ws), eq(paymentReminders.status, "entwurf")));
    } else if (DRAFT_VERWORFEN.has(row.draftStatus)) {
      await db
        .update(paymentReminders)
        .set({ status: "verworfen", updatedAt: jetzt })
        .where(and(eq(paymentReminders.id, row.reminderId), eq(paymentReminders.workspaceId, ws), eq(paymentReminders.status, "entwurf")));
    }
  }
}

async function stoppeErledigte(ws: string, summary: ErinnerungLauf): Promise<void> {
  const offen = await db
    .select({
      id: paymentReminders.id,
      draftId: paymentReminders.draftId,
      dealRecordId: paymentReminders.dealRecordId,
      invoiceStatus: dealInvoices.status,
      bruttoCent: dealInvoices.bruttoCent,
      modus: companySettings.erinnerungModus,
    })
    .from(paymentReminders)
    .innerJoin(dealInvoices, eq(dealInvoices.id, paymentReminders.invoiceId))
    .leftJoin(companySettings, eq(companySettings.operatingCompanyRecordId, dealInvoices.operatingCompanyId))
    .where(and(eq(paymentReminders.workspaceId, ws), eq(paymentReminders.status, "entwurf")));
  if (offen.length === 0) return;

  const dealIds = [...new Set(offen.map((r) => r.dealRecordId))];
  const [zahlungsZeilen, ereignisse] = await Promise.all([
    db
      .select({
        dealRecordId: payments.dealRecordId,
        amount: payments.amount,
        taxTreatment: payments.taxTreatment,
      })
      .from(payments)
      .where(and(eq(payments.workspaceId, ws), inArray(payments.dealRecordId, dealIds))),
    db
      .select({
        id: activityEvents.id,
        recordId: activityEvents.recordId,
        eventType: activityEvents.eventType,
        payload: activityEvents.payload,
        createdAt: activityEvents.createdAt,
      })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.workspaceId, ws),
          inArray(activityEvents.recordId, dealIds),
          inArray(activityEvents.eventType, [...MELDUNG_EREIGNISTYPEN])
        )
      ),
  ]);

  const zahlungenJeDeal = gruppe(
    zahlungsZeilen.filter((z) => z.dealRecordId),
    (z) => z.dealRecordId as string
  );
  const ereignisJeDeal = gruppe(
    ereignisse.filter((e) => e.recordId),
    (e) => e.recordId as string
  );

  for (const row of offen) {
    const grund = stoppGrund(row, zahlungenJeDeal.get(row.dealRecordId) ?? [], ereignisJeDeal.get(row.dealRecordId) ?? []);
    if (!grund) continue;
    const jetzt = new Date();
    await db
      .update(paymentReminders)
      .set({ status: "gestoppt", stoppGrund: grund, updatedAt: jetzt })
      .where(and(eq(paymentReminders.id, row.id), eq(paymentReminders.workspaceId, ws), eq(paymentReminders.status, "entwurf")));
    if (row.draftId) await entwurfSchliessen(ws, row.draftId, grund, jetzt);
    summary.gestoppt += 1;
  }
}

function stoppGrund(
  row: { invoiceStatus: string; bruttoCent: number | null; modus?: string | null },
  zahlungen: { amount: string | null; taxTreatment: string | null }[],
  ereignisse: { id: string; eventType: string; payload: unknown; createdAt: Date }[]
): string | null {
  if (row.invoiceStatus !== "gestellt") return "nicht_gestellt";
  // Fix-Welle M10: Schalter der Firma aus → offene Entwürfe ersetzen.
  if (row.modus !== "entwurf") return "schalter_aus";
  const rest = offenAus({
    rechnung: { status: row.invoiceStatus as RechnungStatus, bruttoCent: row.bruttoCent },
    annahmeCent: null,
    festpreis: null,
    istStunden: false,
    zahlungen,
  }).restCent;
  if (rest != null && rest <= 0) return "bezahlt";
  if (offeneMeldungen(ereignisse).length > 0) return "meldung_offen";
  return null;
}

/** Dieselbe Schließung wie `draft-schliessen.ts`, nur für diesen einen Entwurf. */
async function entwurfSchliessen(ws: string, draftId: string, grund: string, jetzt: Date): Promise<void> {
  await db
    .update(agentDrafts)
    .set({
      status: "superseded",
      reviewerUserId: null,
      reviewedAt: jetzt,
      updatedAt: jetzt,
      filterVerdicts: sql`coalesce(${agentDrafts.filterVerdicts}, '{}'::jsonb) || ${JSON.stringify({
        supersededBy: grund,
        supersededAt: jetzt.toISOString(),
      })}::jsonb`,
    })
    .where(and(eq(agentDrafts.id, draftId), eq(agentDrafts.workspaceId, ws), eq(agentDrafts.status, "pending")));
}

async function bearbeite(kandidat: ErinnerungKandidat, jetzt: Date, summary: ErinnerungLauf): Promise<void> {
  const entscheidung = erinnerungFaellig(kandidat.eingabe);
  if (entscheidung.stufe == null) {
    grundDazu(summary, entscheidung.grund);
    if (entscheidung.grund === "kein_kanal") summary.ohneKanal += 1;
    return;
  }

  if (await capErreicht(kandidat, jetzt)) {
    grundDazu(summary, "noch_nicht");
    return;
  }

  const stufe = entscheidung.stufe;
  const text = erinnerungText({ ...kandidat.text, stufe });
  const erstellt = await createAgentDraft({
    workspaceId: kandidat.workspaceId,
    conversationId: kandidat.conversationId ?? undefined,
    dealRecordId: kandidat.dealRecordId,
    messageClass: "followup",
    draftText: text,
    reasoning: `Zahlungserinnerung Stufe ${stufe}`,
    source: ERINNERUNG_QUELLE,
    sequenceId: ERINNERUNG_QUELLE,
    sequenceStep: stufe,
    idempotencyKey: erinnerungSchluessel(kandidat.invoiceId, stufe),
    meta: {
      // Der Betrag ist gewollt: die Preis-Prüfung beim Senden nimmt genau diese Angabe aus (ohnePreisPhrase).
      preisPhrase: euro(kandidat.text.betragCent),
      zahlungserinnerung: {
        invoiceId: kandidat.invoiceId,
        stufe,
        betreff: erinnerungBetreff(kandidat.text),
      },
    },
  });

  let draftId: string | null = null;
  if (erstellt.ok) {
    draftId = erstellt.draft.id;
  } else if (erstellt.error === "draft_exists" && erstellt.existingDraftId) {
    // Nur ein eigener Entwurf (gleicher Schlüssel) zählt; liegt ein anderer
    // Entwurf (z. B. Nachfass) am Deal, wartet die Erinnerung auf den nächsten Lauf.
    const [vorhanden] = await db
      .select({ key: agentDrafts.idempotencyKey })
      .from(agentDrafts)
      .where(and(eq(agentDrafts.id, erstellt.existingDraftId), eq(agentDrafts.workspaceId, kandidat.workspaceId)))
      .limit(1);
    if (vorhanden?.key !== erinnerungSchluessel(kandidat.invoiceId, stufe)) {
      grundDazu(summary, "entwurf_liegt");
      return;
    }
    draftId = erstellt.existingDraftId;
  } else {
    console.error("[zahlungserinnerung] draft:", kandidat.invoiceId, erstellt.ok ? "" : erstellt.error);
    summary.fehler += 1;
    return;
  }

  const faelligAm = kandidat.eingabe.rechnung.faelligAm;
  const restCent = kandidat.eingabe.restCent;
  if (!faelligAm || restCent == null) return;

  const inserted = await db
    .insert(paymentReminders)
    .values({
      workspaceId: kandidat.workspaceId,
      dealRecordId: kandidat.dealRecordId,
      invoiceId: kandidat.invoiceId,
      stufe,
      faelligAm,
      restCent,
      status: "entwurf",
      kanal: kandidat.eingabe.kanal,
      draftId,
    })
    .onConflictDoNothing({ target: [paymentReminders.invoiceId, paymentReminders.stufe] })
    .returning({ id: paymentReminders.id });
  if (inserted.length > 0) summary.entwuerfe += 1;
}

async function capErreicht(kandidat: ErinnerungKandidat, jetzt: Date): Promise<boolean> {
  if (!kandidat.conversationId) return false;
  const [conv] = await db
    .select({ channelAccountId: inboxConversations.channelAccountId })
    .from(inboxConversations)
    .where(and(eq(inboxConversations.id, kandidat.conversationId), eq(inboxConversations.workspaceId, kandidat.workspaceId)))
    .limit(1);
  if (!conv) return false;
  const [satz] = await db
    .select({ sentCount: nachfassDailySends.sentCount })
    .from(nachfassDailySends)
    .where(
      and(
        eq(nachfassDailySends.workspaceId, kandidat.workspaceId),
        eq(nachfassDailySends.channelAccountId, conv.channelAccountId),
        eq(nachfassDailySends.berlinDay, berlinTag(jetzt))
      )
    )
    .limit(1);
  return kundenCapErreicht(satz?.sentCount ?? 0);
}

function grundDazu(summary: ErinnerungLauf, grund: ErinnerungGrund): void {
  summary.gruende[grund] = (summary.gruende[grund] ?? 0) + 1;
}

function gruppe<T>(zeilenListe: T[], key: (z: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const z of zeilenListe) {
    const k = key(z);
    const liste = map.get(k);
    if (liste) liste.push(z);
    else map.set(k, [z]);
  }
  return map;
}

function leer(): ErinnerungLauf {
  return { workspaces: 0, geprueft: 0, entwuerfe: 0, gestoppt: 0, ohneKanal: 0, fehler: 0, gruende: {} };
}

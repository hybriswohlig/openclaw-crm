/**
 * Bewertungs-Modus und Portal-Haken je Betriebsfirma (Plan 11, Entscheidung 1).
 *
 * Felder in `company_settings`: `bewertung_modus` (aus | entwurf | senden),
 * `bewertung_modus_seit`, `bewertung_haken_portal`. Ohne Zeile gilt: aus,
 * kein Seit, kein Haken.
 *
 * Offene Automatik-Zeilen folgen dem Modus (Fix-Welle M2): Senden → Entwurf
 * macht sie zu Entwürfen, Ausschalten verwirft „auto“ und „entwurf“ (Grund
 * MODUS); Vormerkungen von Hand bleiben.
 *
 * `seit` wird gesetzt beim Wechsel von „aus“ auf einen anderen Modus, bleibt
 * beim Wechsel zwischen „entwurf“ und „senden“, wird beim Ausschalten nicht
 * gelöscht und beim nächsten Einschalten neu gesetzt. Anker vor `seit` zählen
 * für die Automatik nie (Altaufträge).
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents } from "@/db/schema/activity";
import { companySettings } from "@/db/schema/company-settings";
import { objects } from "@/db/schema/objects";
import { records } from "@/db/schema/records";
import { istBewertungModus, type BewertungModus } from "@/lib/bewertungen-kunden";
import type { ActivityEventType } from "@/services/activity-events";
import type { DbExecutor } from "@/services/kva-annahme";

export interface BewertungFirmaModus {
  modus: BewertungModus;
  seit: Date | null;
  hakenPortal: boolean;
}

export const MODUS_STANDARD: Readonly<BewertungFirmaModus> = Object.freeze({ modus: "aus", seit: null, hakenPortal: false });

/** Ungültige Eingabe (400) oder fremde Firma (404). */
export class BewertungModusFehler extends Error {
  constructor(
    public readonly code: "EINGABE" | "FIRMA",
    message: string
  ) {
    super(message);
    this.name = "BewertungModusFehler";
  }
}

function modusAus(row: { modus: string | null; seit: Date | null; haken: boolean | null }): BewertungFirmaModus {
  return {
    modus: istBewertungModus(row.modus) ? row.modus : "aus",
    seit: row.seit ?? null,
    hakenPortal: row.haken === true,
  };
}

/** Alle Firmen des Workspace mit Zeile; Firmen ohne Zeile fehlen in der Map (gilt „aus“). */
export async function ladeBewertungModi(ws: string, ex: DbExecutor = db): Promise<Map<string, BewertungFirmaModus>> {
  const rows = await ex
    .select({
      ocId: companySettings.operatingCompanyRecordId,
      modus: companySettings.bewertungModus,
      seit: companySettings.bewertungModusSeit,
      haken: companySettings.bewertungHakenPortal,
    })
    .from(companySettings)
    .where(eq(companySettings.workspaceId, ws));
  return new Map(rows.map((r) => [r.ocId, modusAus(r)]));
}

/** Modus einer Firma; ohne Zeile „aus“, null, false. */
export async function ladeBewertungModus(ws: string, ocId: string, ex: DbExecutor = db): Promise<BewertungFirmaModus> {
  const [row] = await ex
    .select({
      modus: companySettings.bewertungModus,
      seit: companySettings.bewertungModusSeit,
      haken: companySettings.bewertungHakenPortal,
    })
    .from(companySettings)
    .where(and(eq(companySettings.operatingCompanyRecordId, ocId), eq(companySettings.workspaceId, ws)))
    .limit(1);
  return row ? modusAus(row) : { ...MODUS_STANDARD };
}

/** Neues `seit` nach Entscheidung 1 (rein, für Tests exportiert). */
export function neuesSeit(vorher: BewertungFirmaModus, modus: BewertungModus, jetzt: Date): Date | null {
  if (vorher.modus === "aus" && modus !== "aus") return jetzt;
  return vorher.seit;
}

/**
 * Upsert von Modus und/oder Haken. Prüft, dass `ocId` ein lebender
 * `operating_companies`-Datensatz des Workspace ist (sonst FIRMA). Schreibt
 * `bewertung.modus_geaendert` am Firmendatensatz, wenn sich etwas ändert.
 */
export async function bewertungModusSetzen(
  ws: string,
  ocId: string,
  e: { modus?: BewertungModus; hakenPortal?: boolean },
  userId: string,
  jetzt: Date = new Date()
): Promise<void> {
  if (e.modus !== undefined && !istBewertungModus(e.modus)) {
    throw new BewertungModusFehler("EINGABE", "Modus muss aus, entwurf oder senden sein.");
  }
  if (e.hakenPortal !== undefined && typeof e.hakenPortal !== "boolean") {
    throw new BewertungModusFehler("EINGABE", "Portal-Haken muss an oder aus sein.");
  }

  await db.transaction(async (tx) => {
    const [firma] = await tx
      .select({ id: records.id })
      .from(records)
      .innerJoin(objects, eq(objects.id, records.objectId))
      .where(
        and(
          eq(records.id, ocId),
          isNull(records.deletedAt),
          eq(objects.workspaceId, ws),
          eq(objects.slug, "operating_companies")
        )
      )
      .limit(1);
    if (!firma) throw new BewertungModusFehler("FIRMA", "Firma nicht gefunden.");

    // Zeile sperren, damit zwei gleichzeitige Wechsel `seit` nicht verlieren.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('bewertung-modus:' || ${ws} || ':' || ${ocId}))`);
    const vorher = await ladeBewertungModus(ws, ocId, tx);
    const modus = e.modus ?? vorher.modus;
    const hakenPortal = e.hakenPortal ?? vorher.hakenPortal;
    const seit = neuesSeit(vorher, modus, jetzt);
    if (modus === vorher.modus && hakenPortal === vorher.hakenPortal && seit?.getTime() === vorher.seit?.getTime()) return;

    await tx
      .insert(companySettings)
      .values({
        operatingCompanyRecordId: ocId,
        workspaceId: ws,
        bewertungModus: modus,
        bewertungModusSeit: seit,
        bewertungHakenPortal: hakenPortal,
        updatedAt: jetzt,
      })
      .onConflictDoUpdate({
        target: companySettings.operatingCompanyRecordId,
        set: { bewertungModus: modus, bewertungModusSeit: seit, bewertungHakenPortal: hakenPortal, updatedAt: jetzt },
      });
    // Fix-Welle M2: offene Zeilen der Automatik folgen dem Modus. Senden → Entwurf: sie warten
    // auf Freigabe. Ausschalten: sie werden verworfen und erscheinen wieder als „fällig“ von Hand.
    if (vorher.modus === "senden" && modus === "entwurf") {
      await tx.execute(sql`
        UPDATE review_vormerkungen SET art = 'entwurf', updated_at = now()
        WHERE workspace_id = ${ws} AND operating_company_record_id = ${ocId} AND status = 'offen' AND art = 'auto'
      `);
    }
    if (modus === "aus" && vorher.modus !== "aus") {
      await tx.execute(sql`
        UPDATE review_vormerkungen
        SET status = 'verworfen', sperre = 'MODUS', erledigt_at = now(), erledigt_von = ${userId}, updated_at = now()
        WHERE workspace_id = ${ws} AND operating_company_record_id = ${ocId} AND status = 'offen' AND art IN ('auto', 'entwurf')
      `);
    }
    await tx.insert(activityEvents).values({
      workspaceId: ws,
      recordId: ocId,
      objectSlug: "operating_companies",
      eventType: "bewertung.modus_geaendert" satisfies ActivityEventType,
      payload: {
        vorher: { modus: vorher.modus, hakenPortal: vorher.hakenPortal },
        nachher: { modus, hakenPortal },
        seit: seit?.toISOString() ?? null,
      },
      actorId: userId,
    });
  });
}

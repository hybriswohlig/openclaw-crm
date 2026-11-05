/**
 * Firmen-Einstellungen je Betriebsfirma: Zeitposten-Bibliothek und Rechner-Marke.
 * Ohne Zeile gilt: keine Zeitposten, Marke aus dem Firmennamen.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { companySettings } from "@/db/schema/company-settings";
import { objects } from "@/db/schema/objects";
import { records } from "@/db/schema/records";
import { pruefeZeitposten, type ZeitpostenVorlage } from "@/lib/zeitposten";
import type { Marke } from "@/services/rechner/quelle";

export interface FirmenEinstellungen {
  zeitposten: ZeitpostenVorlage[];
  rechnerMarke: Marke | null;
}

export interface FirmenEinstellungenPatch {
  zeitposten?: ZeitpostenVorlage[];
  rechnerMarke?: Marke | null;
}

function markeOderNull(wert: unknown): Marke | null {
  return wert === "kottke" || wert === "ceylan" ? wert : null;
}

/** Ohne Zeile: leere Bibliothek, keine gespeicherte Marke. */
export async function ladeFirmenEinstellungen(workspaceId: string, ocId: string): Promise<FirmenEinstellungen> {
  const [row] = await db
    .select({
      zeitposten: companySettings.zeitposten,
      rechnerMarke: companySettings.rechnerMarke,
    })
    .from(companySettings)
    .where(and(eq(companySettings.operatingCompanyRecordId, ocId), eq(companySettings.workspaceId, workspaceId)))
    .limit(1);
  if (!row) return { zeitposten: [], rechnerMarke: null };

  let zeitposten: ZeitpostenVorlage[] = [];
  try {
    zeitposten = pruefeZeitposten(row.zeitposten);
  } catch {
    zeitposten = [];
  }
  return { zeitposten, rechnerMarke: markeOderNull(row.rechnerMarke) };
}

/**
 * Legt die Zeile an oder überschreibt nur die Felder im Patch.
 * `null`, wenn `ocId` kein lebendes `operating_companies`-Record dieses Workspace ist.
 */
export async function speichereFirmenEinstellungen(
  workspaceId: string,
  ocId: string,
  patch: FirmenEinstellungenPatch
): Promise<void | null> {
  const [obj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "operating_companies")))
    .limit(1);
  if (!obj) return null;

  const [rec] = await db
    .select({ id: records.id })
    .from(records)
    .where(and(eq(records.id, ocId), eq(records.objectId, obj.id), isNull(records.deletedAt)))
    .limit(1);
  if (!rec) return null;

  const zeitposten = patch.zeitposten === undefined ? undefined : pruefeZeitposten(patch.zeitposten);
  const jetzt = new Date();
  await db
    .insert(companySettings)
    .values({
      operatingCompanyRecordId: ocId,
      workspaceId,
      zeitposten: zeitposten ?? [],
      rechnerMarke: patch.rechnerMarke ?? null,
      updatedAt: jetzt,
    })
    .onConflictDoUpdate({
      target: companySettings.operatingCompanyRecordId,
      set: {
        workspaceId,
        ...(zeitposten !== undefined ? { zeitposten } : {}),
        ...(patch.rechnerMarke !== undefined ? { rechnerMarke: patch.rechnerMarke } : {}),
        updatedAt: jetzt,
      },
    });
}

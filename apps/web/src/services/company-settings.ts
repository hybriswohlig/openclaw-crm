/**
 * Firmen-Einstellungen je Betriebsfirma: Zeitposten-Bibliothek, Rechner-Marke,
 * Zahlungsregel und Steuernummer (Plan 9).
 * Ohne Zeile gilt: keine Zeitposten, Marke aus dem Firmennamen,
 * `ZAHLUNGSREGEL_STANDARD`, keine Steuernummer.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { companySettings } from "@/db/schema/company-settings";
import { objects } from "@/db/schema/objects";
import { records } from "@/db/schema/records";
import { pruefeZeitposten, type ZeitpostenVorlage } from "@/lib/zeitposten";
import { pruefeSteuernummer, pruefeZahlungsregel, ZAHLUNGSREGEL_STANDARD, type FirmenZahlungsregel } from "@/lib/geld";
import type { DbExecutor } from "@/services/kva-annahme";
import type { Marke } from "@/services/rechner/quelle";

export interface FirmenEinstellungen {
  zeitposten: ZeitpostenVorlage[];
  rechnerMarke: Marke | null;
  zahlung: FirmenZahlungsregel;
  /** Leer zulässig; das Ceylan-PDF druckt sie nur, wenn gesetzt. */
  steuernummer: string | null;
}

export interface FirmenEinstellungenPatch {
  zeitposten?: ZeitpostenVorlage[];
  rechnerMarke?: Marke | null;
  zahlung?: Partial<FirmenZahlungsregel>;
  steuernummer?: string | null;
}

/** Zahlungsregel einer Firma; ohne Zeile der Standard. */
export async function ladeZahlungsregel(
  workspaceId: string,
  ocId: string | null,
  ex: DbExecutor = db
): Promise<FirmenZahlungsregel> {
  if (!ocId) return { ...ZAHLUNGSREGEL_STANDARD };
  const [row] = await ex
    .select({
      basis: companySettings.zahlungszielBasis,
      tage: companySettings.zahlungszielTage,
      erinnerungModus: companySettings.erinnerungModus,
      erinnerungTage: companySettings.erinnerungTage,
      erinnerung2Tage: companySettings.erinnerung2Tage,
    })
    .from(companySettings)
    .where(and(eq(companySettings.operatingCompanyRecordId, ocId), eq(companySettings.workspaceId, workspaceId)))
    .limit(1);
  return row ? zahlungsregelAus(row) : { ...ZAHLUNGSREGEL_STANDARD };
}

function zahlungsregelAus(row: {
  basis: string | null;
  tage: number | null;
  erinnerungModus: string | null;
  erinnerungTage: number | null;
  erinnerung2Tage: number | null;
}): FirmenZahlungsregel {
  const s = ZAHLUNGSREGEL_STANDARD;
  return {
    basis: row.basis === "rechnungstag" ? "rechnungstag" : row.basis === "umzugstag" ? "umzugstag" : s.basis,
    tage: row.tage ?? s.tage,
    erinnerungModus: row.erinnerungModus === "entwurf" ? "entwurf" : "aus",
    erinnerungTage: row.erinnerungTage ?? s.erinnerungTage,
    erinnerung2Tage: row.erinnerung2Tage ?? s.erinnerung2Tage,
  };
}

/** Steuernummer einer Firma (für den CRM-Renderer). */
export async function ladeSteuernummer(workspaceId: string, ocId: string | null, ex: DbExecutor = db): Promise<string | null> {
  if (!ocId) return null;
  const [row] = await ex
    .select({ steuernummer: companySettings.steuernummer })
    .from(companySettings)
    .where(and(eq(companySettings.operatingCompanyRecordId, ocId), eq(companySettings.workspaceId, workspaceId)))
    .limit(1);
  return row?.steuernummer?.trim() || null;
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
      basis: companySettings.zahlungszielBasis,
      tage: companySettings.zahlungszielTage,
      erinnerungModus: companySettings.erinnerungModus,
      erinnerungTage: companySettings.erinnerungTage,
      erinnerung2Tage: companySettings.erinnerung2Tage,
      steuernummer: companySettings.steuernummer,
    })
    .from(companySettings)
    .where(and(eq(companySettings.operatingCompanyRecordId, ocId), eq(companySettings.workspaceId, workspaceId)))
    .limit(1);
  if (!row) return { zeitposten: [], rechnerMarke: null, zahlung: { ...ZAHLUNGSREGEL_STANDARD }, steuernummer: null };

  let zeitposten: ZeitpostenVorlage[] = [];
  try {
    zeitposten = pruefeZeitposten(row.zeitposten);
  } catch {
    zeitposten = [];
  }
  return {
    zeitposten,
    rechnerMarke: markeOderNull(row.rechnerMarke),
    zahlung: zahlungsregelAus(row),
    steuernummer: row.steuernummer?.trim() || null,
  };
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
  const zahlung = patch.zahlung === undefined ? {} : pruefeZahlungsregel(patch.zahlung);
  const steuernummer = patch.steuernummer === undefined ? undefined : pruefeSteuernummer(patch.steuernummer);
  const zahlungSpalten = {
    ...(zahlung.basis !== undefined ? { zahlungszielBasis: zahlung.basis } : {}),
    ...(zahlung.tage !== undefined ? { zahlungszielTage: zahlung.tage } : {}),
    ...(zahlung.erinnerungModus !== undefined ? { erinnerungModus: zahlung.erinnerungModus } : {}),
    ...(zahlung.erinnerungTage !== undefined ? { erinnerungTage: zahlung.erinnerungTage } : {}),
    ...(zahlung.erinnerung2Tage !== undefined ? { erinnerung2Tage: zahlung.erinnerung2Tage } : {}),
    ...(steuernummer !== undefined ? { steuernummer } : {}),
  };
  const jetzt = new Date();
  await db
    .insert(companySettings)
    .values({
      operatingCompanyRecordId: ocId,
      workspaceId,
      zeitposten: zeitposten ?? [],
      rechnerMarke: patch.rechnerMarke ?? null,
      ...zahlungSpalten,
      updatedAt: jetzt,
    })
    .onConflictDoUpdate({
      target: companySettings.operatingCompanyRecordId,
      set: {
        workspaceId,
        ...(zeitposten !== undefined ? { zeitposten } : {}),
        ...(patch.rechnerMarke !== undefined ? { rechnerMarke: patch.rechnerMarke } : {}),
        ...zahlungSpalten,
        updatedAt: jetzt,
      },
    });
}

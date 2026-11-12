import { explicitInvoiceDueDay, invoiceDueDay } from "@/lib/invoice-due-date";
import { getObjectBySlug } from "@/services/objects";
import { getRecord, updateRecord } from "@/services/records";

/**
 * Writes the existing date attribute. No new column and no migration:
 * `rechnung_faellig_am` is already on deals.
 */
export async function setRechnungFaelligAm(input: {
  workspaceId: string;
  dealRecordId: string;
  dueDay: string;
  updatedBy: string | null;
}): Promise<{ ok: true } | { ok: false; warning: string }> {
  try {
    const obj = await getObjectBySlug(input.workspaceId, "deals");
    if (!obj) {
      return {
        ok: false,
        warning: "failed to set rechnung_faellig_am: deals object missing",
      };
    }
    const record = await updateRecord(
      obj.id,
      input.dealRecordId,
      { rechnung_faellig_am: input.dueDay },
      input.updatedBy
    );
    if (!record) {
      return { ok: false, warning: "failed to set rechnung_faellig_am: deal not found" };
    }
    return { ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, warning: `failed to set rechnung_faellig_am: ${detail}` };
  }
}

/** Leert `rechnung_faellig_am` (Storno der Rechnung). Fehler nur als Warnung. */
export async function leereRechnungFaelligAm(input: {
  workspaceId: string;
  dealRecordId: string;
  updatedBy: string | null;
}): Promise<{ ok: true } | { ok: false; warning: string }> {
  try {
    const obj = await getObjectBySlug(input.workspaceId, "deals");
    if (!obj) return { ok: false, warning: "deals object missing" };
    const record = await updateRecord(obj.id, input.dealRecordId, { rechnung_faellig_am: null }, input.updatedBy);
    return record ? { ok: true } : { ok: false, warning: "deal not found" };
  } catch (err) {
    return { ok: false, warning: err instanceof Error ? err.message : String(err) };
  }
}

async function umzugstag(objectId: string, dealRecordId: string): Promise<string | null> {
  try {
    const record = await getRecord(objectId, dealRecordId);
    return explicitInvoiceDueDay(record?.values?.move_date);
  } catch {
    return null;
  }
}

/**
 * Invoice stores set `rechnung_faellig_am`. Every other document type
 * leaves the field alone. The day is the move date, or the invoice date
 * when the invoice is issued on or after the move. A later explicit day
 * is not written. The same rule applies to every company.
 */
export async function applyInvoiceDueDate(input: {
  documentType: string;
  workspaceId: string;
  dealRecordId: string;
  explicitDueDate?: unknown;
  updatedBy: string | null;
  now?: Date;
}): Promise<{ rechnungFaelligAm: string | null; dueDateWarning?: string }> {
  if (input.documentType !== "invoice") return { rechnungFaelligAm: null };
  const obj = await getObjectBySlug(input.workspaceId, "deals");
  if (!obj) {
    return { rechnungFaelligAm: null, dueDateWarning: "failed to set rechnung_faellig_am: deals object missing" };
  }
  const dueDay = invoiceDueDay(input.explicitDueDate, input.now, await umzugstag(obj.id, input.dealRecordId));
  const stamped = await setRechnungFaelligAm({
    workspaceId: input.workspaceId,
    dealRecordId: input.dealRecordId,
    dueDay,
    updatedBy: input.updatedBy,
  });
  if (!stamped.ok) {
    return { rechnungFaelligAm: null, dueDateWarning: stamped.warning };
  }
  return { rechnungFaelligAm: dueDay };
}

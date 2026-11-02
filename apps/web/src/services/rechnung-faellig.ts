import { invoiceDueDay } from "@/lib/invoice-due-date";
import { getObjectBySlug } from "@/services/objects";
import { updateRecord } from "@/services/records";

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

/**
 * Invoice stores set `rechnung_faellig_am`. Every other document type
 * leaves the field alone. An explicit due date wins; otherwise the
 * upload day is used for Kottke and Ceylan alike.
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
  const dueDay = invoiceDueDay(input.explicitDueDate, input.now);
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

/**
 * Due day written to the existing deal attribute `rechnung_faellig_am`
 * when an invoice (documentType invoice / RE) is uploaded or stored.
 *
 * The day is the move date when the invoice is issued before the move.
 * When the invoice is issued on or after the move day, the day is the
 * invoice date. There is no later default and no today + 7. The same
 * rule applies to every company. A caller-supplied day is kept only
 * when it is not later than that day.
 */

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;
const DE_DAY = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

export function berlinCalendarDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function realDay(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year.toString().padStart(4, "0")}-${mm}-${dd}`;
}

/** ISO day from a passed due date, or null when nothing usable was passed. */
export function explicitInvoiceDueDay(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return realDay(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const de = DE_DAY.exec(trimmed);
  if (de) return realDay(Number(de[3]), Number(de[2]), Number(de[1]));
  const iso = ISO_DAY.exec(trimmed);
  if (!iso) return null;
  return realDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));
}

/**
 * Move day when the invoice is issued before the move, otherwise the
 * invoice day. A missing or invalid move day leaves the invoice day.
 */
export function restDueDay(invoiceDay: string, moveDay: string | null | undefined): string {
  if (moveDay && /^\d{4}-\d{2}-\d{2}$/.test(moveDay) && moveDay > invoiceDay) return moveDay;
  return invoiceDay;
}

/**
 * The remaining-balance day. An explicit day is kept when it is not later
 * than that day. "sofort" and any other non-date fall through to the rule.
 */
export function invoiceDueDay(explicit: unknown, now = new Date(), moveDate?: unknown): string {
  const invoiceDay = berlinCalendarDay(now);
  const rule = restDueDay(invoiceDay, explicitInvoiceDueDay(moveDate));
  const passed = explicitInvoiceDueDay(explicit);
  if (passed && passed <= rule) return passed;
  return rule;
}

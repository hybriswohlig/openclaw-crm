import { daysBetween, plusDays } from "./dates";

export interface CalendarQuery {
  from: string;
  to: string;
  companyIds: string[];
  stageIds: string[];
  includeClosed: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID_TOKEN = /^[A-Za-z0-9_-]{1,80}$/;

export function parseIsoDate(value: string | null | undefined): string | null {
  if (!value || !ISO_DATE.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== m - 1 ||
    check.getUTCDate() !== d
  ) {
    return null;
  }
  return value;
}

export function parseIdList(value: string | null | undefined): string[] {
  if (!value) return [];
  const ids: string[] = [];
  for (const part of value.split(",")) {
    const id = part.trim();
    if (!id) continue;
    if (!ID_TOKEN.test(id)) continue;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function parseBool(value: string | null | undefined): boolean {
  if (!value) return false;
  return value === "1" || value === "true" || value === "yes";
}

export function parseCalendarQuery(
  params: URLSearchParams,
  options?: { defaultRange?: { from: string; to: string } }
): { ok: true; query: CalendarQuery } | { ok: false; error: string } {
  const fallback = options?.defaultRange;
  const from = parseIsoDate(params.get("from")) ?? fallback?.from ?? null;
  const to = parseIsoDate(params.get("to")) ?? fallback?.to ?? null;
  if (!from || !to) {
    return { ok: false, error: "from und to müssen YYYY-MM-DD sein." };
  }
  if (from > to) return { ok: false, error: "from liegt nach to." };
  if (daysBetween(from, to) > 400) {
    return { ok: false, error: "Zeitraum ist zu lang (maximal 400 Tage)." };
  }
  return {
    ok: true,
    query: {
      from,
      to,
      companyIds: parseIdList(params.get("company")),
      stageIds: parseIdList(params.get("stage")),
      includeClosed: parseBool(params.get("includeClosed")),
    },
  };
}

/** Subscribers poll the whole feed. A rolling window stays fresh without a year of history. */
export function defaultFeedRange(today: string): { from: string; to: string } {
  return { from: plusDays(today, -14), to: plusDays(today, 180) };
}

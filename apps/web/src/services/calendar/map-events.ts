import { locationValueToText } from "@/lib/adresse";
import { addHours, parseClock, plusDays } from "./dates";

export interface CalendarStage {
  id: string;
  title: string;
  color: string;
  sortOrder: number;
  excludedByDefault: boolean;
}

export interface CalendarCompany {
  id: string;
  name: string;
  color: string;
}

export interface CalendarEvent {
  id: string;
  /** Stable ICS UID. The date is not part of it, so a reschedule replaces the event. */
  uid: string;
  dealId: string;
  kind: "move" | "appointment";
  title: string;
  appointmentLabel: string | null;
  /** Inclusive start, Europe/Berlin calendar day. */
  date: string;
  /** Inclusive end day. */
  endDate: string;
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  fromShort: string | null;
  toShort: string | null;
  stageId: string | null;
  stageTitle: string | null;
  stageColor: string | null;
  stageExcluded: boolean;
  companyId: string | null;
  companyName: string | null;
  companyColor: string;
  estimated: boolean;
  updatedAt: string | null;
  href: string;
}

export interface DealAppointmentInput {
  slug: string;
  label: string;
  date: string;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
}

export interface DealCalendarInput {
  dealId: string;
  customerName: string;
  stageId: string | null;
  stageTitle: string | null;
  stageColor: string | null;
  stageExcluded: boolean;
  companyId: string | null;
  companyName: string | null;
  companyColor: string;
  fromAddress: string | null;
  toAddress: string | null;
  moveDate: string | null;
  moveEndDate: string | null;
  /** Auftrag time window: ISO timestamp or HH:MM. */
  timeStart: string | null;
  timeEnd: string | null;
  /** Confirmed customer slot, HH:MM. */
  slotStart: string | null;
  slotEnd: string | null;
  estimatedFlag: boolean;
  /** One unselected date offer, used only when the deal has no move date. */
  proposedDate: string | null;
  proposedStart: string | null;
  proposedEnd: string | null;
  appointments: DealAppointmentInput[];
  updatedAt: string | null;
}

export interface CalendarFilter {
  from: string;
  to: string;
  companyIds: string[];
  stageIds: string[];
  includeClosed: boolean;
}

const CLOSED_STAGE =
  /^(lost|verloren|cancelled|canceled|storniert|abgesagt|abgebrochen)(\b|[\s(/:-]|$)/;

export function isLostOrCancelledStage(stage: {
  title: string;
  stageCategory?: string | null;
}): boolean {
  const category = (stage.stageCategory ?? "").toLowerCase();
  if (category === "lost" || category === "kein_lead") return true;
  const title = stage.title.trim().toLowerCase();
  if (title === "kein lead") return true;
  return CLOSED_STAGE.test(title);
}

export function classifyDealDateAttribute(
  slug: string,
  title: string
): "move" | "move_end" | "appointment" | "ignore" {
  const blob = `${slug} ${title}`.toLowerCase();
  if (
    /rechnung|faellig|fällig|expected_close|close_date|completed_at|consent|reminder|insights|review_/.test(
      blob
    )
  ) {
    return "ignore";
  }
  if (/besicht|viewing|appointment|ortstermin|vor[\s_-]?ort/.test(blob)) return "appointment";
  if (
    /(move_end|move_date_end|end_date|datum_bis|bis_datum|service_end|umzug_ende|einsatz_ende)/.test(
      blob
    )
  ) {
    return "move_end";
  }
  if (
    slug === "move_date" ||
    slug === "service_date" ||
    /(^|[\s_])(umzugsdatum|move_date|service_date|einsatzdatum)([\s_]|$)/.test(blob)
  ) {
    return "move";
  }
  return "ignore";
}

export function isEstimateAttribute(slug: string, title: string): boolean {
  return /estimate|geschaetzt|geschätzt|vorlaeufig|vorläufig|unbestaetigt|unbestätigt/.test(
    `${slug} ${title}`.toLowerCase()
  );
}

export function appointmentLabel(slug: string, title: string): string {
  if (/besicht/i.test(slug) || /besicht/i.test(title)) return "Besichtigung";
  if (/viewing|appointment|ortstermin/i.test(`${slug} ${title}`)) return "Termin";
  return title.trim() || "Termin";
}

export function addressText(value: unknown): string | null {
  const text = locationValueToText(value).trim();
  return text || null;
}

/** Short label for a cell: "PLZ Ort" when we can see it, otherwise a clipped line. */
export function shortAddress(full: string | null): string | null {
  if (!full) return null;
  const trimmed = full.trim();
  if (!trimmed) return null;
  const postal = trimmed.match(/\b(\d{5})\s+([^,]+)/);
  if (postal) return `${postal[1]} ${postal[2].trim()}`;
  if (trimmed.length <= 28) return trimmed;
  return `${trimmed.slice(0, 26)}…`;
}

function shared(input: DealCalendarInput) {
  return {
    dealId: input.dealId,
    title: input.customerName.trim() || "Ohne Namen",
    fromAddress: input.fromAddress,
    toAddress: input.toAddress,
    fromShort: shortAddress(input.fromAddress),
    toShort: shortAddress(input.toAddress),
    stageId: input.stageId,
    stageTitle: input.stageTitle,
    stageColor: input.stageColor,
    stageExcluded: input.stageExcluded,
    companyId: input.companyId,
    companyName: input.companyName,
    companyColor: input.companyColor,
    updatedAt: input.updatedAt,
    href: `/objects/deals/${input.dealId}`,
  };
}

function clockOnDate(
  date: string,
  start: string | null,
  end: string | null
): { endDate: string; startTime: string; endTime: string } | null {
  const startTime = parseClock(start).time;
  if (!startTime) return null;
  const endClock = parseClock(end).time;
  if (endClock && endClock > startTime) {
    return { endDate: date, startTime, endTime: endClock };
  }
  if (endClock && endClock <= startTime) {
    return { endDate: plusDays(date, 1), startTime, endTime: endClock };
  }
  const plus = addHours(startTime, 2);
  return {
    endDate: plus.dayOffset > 0 ? plusDays(date, plus.dayOffset) : date,
    startTime,
    endTime: plus.time,
  };
}

export function eventsFromDeal(input: DealCalendarInput): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const base = shared(input);
  const windowStart = parseClock(input.timeStart);
  const windowEnd = parseClock(input.timeEnd);

  let date = input.moveDate;
  let estimated = input.estimatedFlag;
  let source: "move" | "window" | "proposal" = "move";

  if (!date && windowStart.date) {
    date = windowStart.date;
    source = "window";
  }
  if (!date && input.proposedDate) {
    date = input.proposedDate;
    estimated = true;
    source = "proposal";
  }
  if (input.estimatedFlag && date) estimated = true;

  if (date) {
    let endDate = input.moveEndDate && input.moveEndDate > date ? input.moveEndDate : date;
    const windowApplies =
      windowStart.time != null &&
      (windowStart.date == null || windowStart.date === date || source === "window");

    if (
      windowApplies &&
      windowEnd.date &&
      windowEnd.date > endDate &&
      (windowStart.date === date || windowStart.date == null || source === "window")
    ) {
      endDate = windowEnd.date;
    }

    let startTime: string | null = null;
    let endTime: string | null = null;

    if (windowApplies && windowStart.time) {
      startTime = windowStart.time;
      endTime = windowEnd.time;
      if (!endTime) {
        const plus = addHours(startTime, 2);
        endTime = plus.time;
        if (plus.dayOffset > 0 && endDate === date) endDate = plusDays(date, plus.dayOffset);
      } else if (endDate === date && endTime <= startTime) {
        endDate = plusDays(date, 1);
      }
    } else if (source === "proposal") {
      const slot = clockOnDate(date, input.proposedStart, input.proposedEnd);
      if (slot && endDate === date) {
        startTime = slot.startTime;
        endTime = slot.endTime;
        endDate = slot.endDate;
      }
    } else {
      const slot = clockOnDate(date, input.slotStart, input.slotEnd);
      if (slot && endDate === date) {
        startTime = slot.startTime;
        endTime = slot.endTime;
        endDate = slot.endDate;
      }
    }

    const allDay = !startTime;
    events.push({
      ...base,
      id: `move:${input.dealId}`,
      uid: `move-${input.dealId}@umzug-suite`,
      kind: "move",
      appointmentLabel: null,
      date,
      endDate,
      allDay,
      startTime: allDay ? null : startTime,
      endTime: allDay ? null : endTime,
      estimated,
    });
  }

  for (const appointment of input.appointments) {
    if (!appointment.date) continue;
    const endDate =
      appointment.endDate && appointment.endDate > appointment.date
        ? appointment.endDate
        : appointment.date;
    const slot = clockOnDate(appointment.date, appointment.startTime, appointment.endTime);
    const timed = Boolean(slot) && endDate === appointment.date;
    events.push({
      ...base,
      id: `appt:${appointment.slug}:${input.dealId}`,
      uid: `appt-${appointment.slug}-${input.dealId}@umzug-suite`,
      kind: "appointment",
      appointmentLabel: appointment.label || "Besichtigung",
      date: appointment.date,
      endDate: timed && slot ? slot.endDate : endDate,
      allDay: !timed,
      startTime: timed && slot ? slot.startTime : null,
      endTime: timed && slot ? slot.endTime : null,
      estimated: false,
    });
  }

  return events;
}

export function filterCalendarEvents(events: CalendarEvent[], filter: CalendarFilter): CalendarEvent[] {
  return events.filter((event) => {
    if (event.date > filter.to || event.endDate < filter.from) return false;
    if (filter.companyIds.length > 0) {
      if (!event.companyId || !filter.companyIds.includes(event.companyId)) return false;
    }
    if (filter.stageIds.length > 0) {
      return Boolean(event.stageId && filter.stageIds.includes(event.stageId));
    }
    if (!filter.includeClosed && event.stageExcluded) return false;
    return true;
  });
}

export function sortCalendarEvents(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate) return byDate;
    const byTime = (a.startTime ?? "99:99").localeCompare(b.startTime ?? "99:99");
    if (byTime) return byTime;
    return a.title.localeCompare(b.title, "de");
  });
}

export function eventCoversDate(event: CalendarEvent, date: string): boolean {
  return event.date <= date && event.endDate >= date;
}

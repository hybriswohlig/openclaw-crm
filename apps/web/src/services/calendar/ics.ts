import { createHash } from "node:crypto";
import type { CalendarEvent } from "./map-events";
import { BERLIN_TZ, icsDate, icsLocalStamp, plusDays } from "./dates";

const BERLIN_VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Berlin",
  "X-LIC-LOCATION:Europe/Berlin",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
].join("\r\n");

export function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/** Fold at 75 octets. Continuation lines start with a single space. */
export function foldIcsLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  let budget = 75;
  while (start < bytes.length) {
    let end = Math.min(bytes.length, start + budget);
    while (end > start && (bytes[end] & 0xc0) === 0x80) end--;
    if (end === start) end = Math.min(bytes.length, start + budget);
    const chunk = bytes.subarray(start, end).toString("utf8");
    parts.push(start === 0 ? chunk : ` ${chunk}`);
    start = end;
    budget = 74;
  }
  return parts.join("\r\n");
}

function foldCalendar(text: string): string {
  return text
    .split("\r\n")
    .map((line) => foldIcsLine(line))
    .join("\r\n");
}

function utcStamp(d: Date): string {
  const iso = d.toISOString().replace(/[-:]/g, "");
  return `${iso.slice(0, 15)}Z`;
}

function summary(event: CalendarEvent): string {
  const name = event.title || "Ohne Namen";
  const prefix = event.appointmentLabel ? `${event.appointmentLabel}: ` : "";
  const suffix = event.estimated ? " (geschätzt)" : "";
  return `${prefix}${name}${suffix}`;
}

function locationOf(event: CalendarEvent): string | null {
  if (event.fromAddress && event.toAddress) return `${event.fromAddress} → ${event.toAddress}`;
  return event.fromAddress || event.toAddress;
}

/**
 * Staff feed: customer name, time, addresses, deal link.
 * No prices, internal notes, or phone numbers.
 */
function description(event: CalendarEvent, dealUrl: string): string {
  const lines: string[] = [];
  if (event.appointmentLabel) lines.push(event.appointmentLabel);
  if (event.estimated) lines.push("Termin ist geschätzt");
  if (event.fromAddress) lines.push(`Von: ${event.fromAddress}`);
  if (event.toAddress) lines.push(`Nach: ${event.toAddress}`);
  lines.push(dealUrl);
  return lines.join("\n");
}

function eventBlock(event: CalendarEvent, dealUrl: string, now: Date): string {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${escapeIcs(event.uid)}`,
    `DTSTAMP:${utcStamp(now)}`,
  ];
  if (event.updatedAt) {
    const updated = new Date(event.updatedAt);
    if (!Number.isNaN(updated.getTime())) lines.push(`LAST-MODIFIED:${utcStamp(updated)}`);
  }
  if (event.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${icsDate(event.date)}`);
    lines.push(`DTEND;VALUE=DATE:${icsDate(plusDays(event.endDate, 1))}`);
  } else {
    lines.push(`DTSTART;TZID=${BERLIN_TZ}:${icsLocalStamp(event.date, event.startTime ?? "00:00")}`);
    lines.push(
      `DTEND;TZID=${BERLIN_TZ}:${icsLocalStamp(event.endDate, event.endTime ?? event.startTime ?? "00:00")}`
    );
  }
  lines.push(`SUMMARY:${escapeIcs(summary(event))}`);
  const location = locationOf(event);
  if (location) lines.push(`LOCATION:${escapeIcs(location)}`);
  lines.push(`DESCRIPTION:${escapeIcs(description(event, dealUrl))}`);
  lines.push(`URL:${escapeIcs(dealUrl)}`);
  lines.push(`STATUS:${event.estimated ? "TENTATIVE" : "CONFIRMED"}`);
  if (event.companyName) lines.push(`CATEGORIES:${escapeIcs(event.companyName)}`);
  lines.push("END:VEVENT");
  return lines.join("\r\n");
}

export function buildCalendarIcs(
  events: CalendarEvent[],
  options: {
    calendarName: string;
    dealUrl: (href: string) => string;
    now?: Date;
  }
): string {
  const now = options.now ?? new Date();
  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Umzug-Suite//Einsatzkalender//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcs(options.calendarName)}`,
    `X-WR-TIMEZONE:${BERLIN_TZ}`,
    "X-PUBLISHED-TTL:PT15M",
    BERLIN_VTIMEZONE,
    ...events.map((event) => eventBlock(event, options.dealUrl(event.href), now)),
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  return foldCalendar(body);
}

export const ICS_CACHE_CONTROL = "private, max-age=60, must-revalidate";

export function icsEtag(body: string): string {
  return `"${createHash("sha256").update(body).digest("hex").slice(0, 32)}"`;
}

export function absoluteUrl(origin: string, href: string): string {
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  const base = origin.replace(/\/$/, "");
  return `${base}${href.startsWith("/") ? href : `/${href}`}`;
}

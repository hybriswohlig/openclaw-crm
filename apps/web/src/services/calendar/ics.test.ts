import { describe, expect, it } from "vitest";
import { buildCalendarIcs, ICS_CACHE_CONTROL } from "./ics";
import { eventsFromDeal, type DealCalendarInput } from "./map-events";
import { KOTTKE_COMPANY_ID } from "./companies";

function eventFrom(overrides: Partial<DealCalendarInput> = {}) {
  const [event] = eventsFromDeal({
    dealId: "deal-1",
    customerName: "Anna Berger",
    stageId: "stage-open",
    stageTitle: "Auftrag fest",
    stageColor: "#008760",
    stageExcluded: false,
    companyId: KOTTKE_COMPANY_ID,
    companyName: "Kottke-Umzüge",
    companyColor: "#1f3a5f",
    fromAddress: "Marktstraße 8, 72218 Wildberg",
    toAddress: "Kapellenberg 13, 72218 Wildberg",
    moveDate: "2026-10-21",
    moveEndDate: null,
    timeStart: null,
    timeEnd: null,
    slotStart: null,
    slotEnd: null,
    estimatedFlag: false,
    proposedDate: null,
    proposedStart: null,
    proposedEnd: null,
    appointments: [],
    updatedAt: "2026-10-19T10:00:00.000Z",
    ...overrides,
  });
  return event;
}

function unfold(ics: string): string {
  return ics.replace(/\r\n[ \t]/g, "");
}

function build(overrides: Partial<DealCalendarInput> = {}) {
  return buildCalendarIcs([eventFrom(overrides)], {
    calendarName: "Einsätze",
    dealUrl: (href) => `https://crm.example${href}`,
    now: new Date("2026-10-19T12:00:00.000Z"),
  });
}

describe("ICS feed", () => {
  it("is a folded RFC 5545 calendar in Europe/Berlin", () => {
    const ics = build({
      customerName: "Anna Berger mit einem sehr langen Namen und einer zusätzlichen Zeile für die Faltung",
      fromAddress: "Eine außergewöhnlich lange Abholadresse 12, 70173 Stuttgart am Ende der Straße",
    });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("BEGIN:VTIMEZONE");
    expect(ics).toContain("TZID:Europe/Berlin");
    expect(ics).not.toMatch(/[^\r]\n/);
    for (const line of ics.split("\r\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }

    const text = unfold(ics);
    expect(text).toContain("BEGIN:VEVENT");
    expect(text).toContain("END:VEVENT");
    expect(text).toContain("UID:move-deal-1@umzug-suite");
    expect(text).toContain("DTSTART;VALUE=DATE:20261021");
    expect(text).toContain("DTEND;VALUE=DATE:20261022");
    expect(text).toContain("URL:https://crm.example/objects/deals/deal-1");
    expect(text).toContain("STATUS:CONFIRMED");
    expect(ICS_CACHE_CONTROL).toBe("private, max-age=60, must-revalidate");
  });

  it("writes timed events with a Berlin timezone id", () => {
    const text = unfold(build({ slotStart: "08:00", slotEnd: "12:30" }));
    expect(text).toContain("DTSTART;TZID=Europe/Berlin:20261021T080000");
    expect(text).toContain("DTEND;TZID=Europe/Berlin:20261021T123000");
    expect(text).not.toContain("VALUE=DATE:20261021");
  });

  it("marks estimated dates as tentative and keeps the same uid", () => {
    const text = unfold(
      build({ moveDate: null, proposedDate: "2026-10-28", proposedStart: null, proposedEnd: null })
    );
    expect(text).toContain("UID:move-deal-1@umzug-suite");
    expect(text).toContain("STATUS:TENTATIVE");
    expect(text).toContain("SUMMARY:Anna Berger (geschätzt)");
    expect(text).toContain("DTSTART;VALUE=DATE:20261028");
  });

  it("includes name, time, addresses and the deal link, and leaves out prices, notes and phones", () => {
    const text = unfold(build({ slotStart: "09:00", slotEnd: "11:00" }));
    expect(text).toContain("SUMMARY:Anna Berger");
    expect(text).toContain("Von: Marktstraße 8\\, 72218 Wildberg");
    expect(text).toContain("Nach: Kapellenberg 13\\, 72218 Wildberg");
    expect(text).toContain("https://crm.example/objects/deals/deal-1");
    expect(text).not.toMatch(/Telefon|Notizen|€|\bEUR\b|\bprice\b|Auftrag fest|\+49/i);
  });
});

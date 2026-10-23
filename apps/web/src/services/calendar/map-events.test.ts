import { describe, expect, it } from "vitest";
import { CEYLAN_COMPANY_ID, KOTTKE_COMPANY_ID, companyColor } from "./companies";
import {
  classifyDealDateAttribute,
  eventsFromDeal,
  filterCalendarEvents,
  isLostOrCancelledStage,
  shortAddress,
  type CalendarEvent,
  type DealCalendarInput,
} from "./map-events";

const KOTTKE = KOTTKE_COMPANY_ID;
const CEYLAN = CEYLAN_COMPANY_ID;

function deal(overrides: Partial<DealCalendarInput> = {}): DealCalendarInput {
  return {
    dealId: "deal-1",
    customerName: "Anna Berger",
    stageId: "stage-open",
    stageTitle: "Auftrag fest",
    stageColor: "#008760",
    stageExcluded: false,
    companyId: KOTTKE,
    companyName: "Kottke-Umzüge",
    companyColor: "#1f3a5f",
    fromAddress: "Marktstr. 8, 72218 Wildberg",
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
  };
}

function moveOf(events: CalendarEvent[]): CalendarEvent {
  const move = events.find((event) => event.kind === "move");
  if (!move) throw new Error("missing move");
  return move;
}

describe("event mapping", () => {
  it("maps a move date without a time to an all-day event with a stable uid", () => {
    const [event] = eventsFromDeal(deal());
    expect(event.uid).toBe("move-deal-1@umzug-suite");
    expect(event.allDay).toBe(true);
    expect(event.date).toBe("2026-10-21");
    expect(event.endDate).toBe("2026-10-21");
    expect(event.startTime).toBeNull();
    expect(event.estimated).toBe(false);
    expect(event.href).toBe("/objects/deals/deal-1");
    expect(event.fromShort).toBe("72218 Wildberg");
    expect(event.toShort).toBe("72218 Wildberg");
    expect(event.title).toBe("Anna Berger");

    const moved = moveOf(eventsFromDeal(deal({ moveDate: "2026-11-02" })));
    expect(moved.uid).toBe(event.uid);
    expect(moved.date).toBe("2026-11-02");
  });

  it("uses the Auftrag time window in Europe/Berlin and spans multiple days", () => {
    const event = moveOf(
      eventsFromDeal(
        deal({
          timeStart: "2026-10-21T06:00:00.000Z",
          timeEnd: "2026-10-22T15:00:00.000Z",
        })
      )
    );
    expect(event.allDay).toBe(false);
    expect(event.date).toBe("2026-10-21");
    expect(event.startTime).toBe("08:00");
    expect(event.endDate).toBe("2026-10-22");
    expect(event.endTime).toBe("17:00");
  });

  it("uses a confirmed slot when the Auftrag has no clock time", () => {
    const event = moveOf(eventsFromDeal(deal({ slotStart: "08:30", slotEnd: "12:00" })));
    expect(event.allDay).toBe(false);
    expect(event.startTime).toBe("08:30");
    expect(event.endTime).toBe("12:00");
    expect(event.estimated).toBe(false);
  });

  it("extends a move across an end date as an all-day span", () => {
    const event = moveOf(eventsFromDeal(deal({ moveEndDate: "2026-10-23" })));
    expect(event.allDay).toBe(true);
    expect(event.date).toBe("2026-10-21");
    expect(event.endDate).toBe("2026-10-23");
  });

  it("adds a Besichtigung as its own event and keeps the move", () => {
    const events = eventsFromDeal(
      deal({
        appointments: [
          {
            slug: "besichtigung",
            label: "Besichtigung",
            date: "2026-10-18",
            endDate: null,
            startTime: "2026-10-18T08:00:00.000Z",
            endTime: "2026-10-18T09:00:00.000Z",
          },
        ],
      })
    );
    expect(events.map((event) => event.kind).sort()).toEqual(["appointment", "move"]);
    const visit = events.find((event) => event.kind === "appointment");
    expect(visit?.uid).toBe("appt-besichtigung-deal-1@umzug-suite");
    expect(visit?.date).toBe("2026-10-18");
    expect(visit?.startTime).toBe("10:00");
    expect(visit?.appointmentLabel).toBe("Besichtigung");
  });

  it("marks an unselected date offer as estimated and ignores it once a move date exists", () => {
    const proposed = moveOf(
      eventsFromDeal(
        deal({
          moveDate: null,
          proposedDate: "2026-10-28",
          proposedStart: "09:00",
          proposedEnd: "11:00",
        })
      )
    );
    expect(proposed.estimated).toBe(true);
    expect(proposed.date).toBe("2026-10-28");
    expect(proposed.startTime).toBe("09:00");
    expect(proposed.uid).toBe("move-deal-1@umzug-suite");

    const confirmed = moveOf(
      eventsFromDeal(
        deal({
          moveDate: "2026-10-21",
          proposedDate: "2026-10-28",
        })
      )
    );
    expect(confirmed.date).toBe("2026-10-21");
    expect(confirmed.estimated).toBe(false);
  });

  it("marks a flagged move date as estimated", () => {
    expect(moveOf(eventsFromDeal(deal({ estimatedFlag: true }))).estimated).toBe(true);
  });

  it("shortens addresses to postcode and city", () => {
    expect(shortAddress("Lange Straße 12, 70173 Stuttgart")).toBe("70173 Stuttgart");
    expect(shortAddress("Nur eine Zeile")).toBe("Nur eine Zeile");
  });
});

describe("company filter and closed stages", () => {
  const events = [
    moveOf(eventsFromDeal(deal({ dealId: "k", companyId: KOTTKE, companyName: "Kottke-Umzüge" }))),
    moveOf(
      eventsFromDeal(
        deal({
          dealId: "c",
          companyId: CEYLAN,
          companyName: "Ceylan Operations",
          companyColor: "#ea580c",
          stageId: "stage-lost",
          stageTitle: "Verloren",
          stageExcluded: true,
        })
      )
    ),
    moveOf(
      eventsFromDeal(
        deal({
          dealId: "none",
          companyId: null,
          companyName: null,
          stageId: "stage-open",
          stageExcluded: false,
        })
      )
    ),
  ];

  const range = { from: "2026-10-01", to: "2026-10-31", stageIds: [], includeClosed: false };

  it("keeps both companies and unassigned deals when no company is selected", () => {
    const filtered = filterCalendarEvents(events, { ...range, companyIds: [] });
    expect(filtered.map((event) => event.dealId).sort()).toEqual(["k", "none"]);
  });

  it("filters to one operating company", () => {
    const filtered = filterCalendarEvents(events, { ...range, companyIds: [CEYLAN], includeClosed: true });
    expect(filtered.map((event) => event.dealId)).toEqual(["c"]);
  });

  it("excludes lost and cancelled stages unless they are requested", () => {
    expect(isLostOrCancelledStage({ title: "Lost" })).toBe(true);
    expect(isLostOrCancelledStage({ title: "Verloren" })).toBe(true);
    expect(isLostOrCancelledStage({ title: "Storniert" })).toBe(true);
    expect(isLostOrCancelledStage({ title: "abgesagt" })).toBe(true);
    expect(isLostOrCancelledStage({ title: "Done", stageCategory: "paid" })).toBe(false);
    expect(isLostOrCancelledStage({ title: "Bezahlt", stageCategory: "lost" })).toBe(true);
    expect(isLostOrCancelledStage({ title: "Kein Lead", stageCategory: "kein_lead" })).toBe(true);

    const hidden = filterCalendarEvents(events, { ...range, companyIds: [] });
    expect(hidden.map((event) => event.dealId)).not.toContain("c");

    const explicit = filterCalendarEvents(events, {
      ...range,
      companyIds: [],
      stageIds: ["stage-lost"],
    });
    expect(explicit.map((event) => event.dealId)).toEqual(["c"]);
  });

  it("drops events outside the requested range", () => {
    const filtered = filterCalendarEvents(events, {
      from: "2026-11-01",
      to: "2026-11-30",
      companyIds: [],
      stageIds: [],
      includeClosed: true,
    });
    expect(filtered).toEqual([]);
  });
});

describe("date field classification", () => {
  it("recognises move, end, and viewing fields and ignores invoices", () => {
    expect(classifyDealDateAttribute("move_date", "Move date")).toBe("move");
    expect(classifyDealDateAttribute("move_date_end", "Umzug bis")).toBe("move_end");
    expect(classifyDealDateAttribute("besichtigung_am", "Besichtigung")).toBe("appointment");
    expect(classifyDealDateAttribute("rechnung_faellig_am", "Rechnung fällig am")).toBe("ignore");
    expect(classifyDealDateAttribute("expected_close_date", "Expected decision date")).toBe("ignore");
  });
});

describe("company colors", () => {
  it("paints the two operating companies differently, and lets portal color win", () => {
    expect(companyColor(KOTTKE, "Kottke-Umzüge", null)).toBe("#1f3a5f");
    expect(companyColor(CEYLAN, "Ceylan Operations", null)).toBe("#ea580c");
    expect(companyColor(CEYLAN, "Ceylan Operations", "112233")).toBe("#112233");
    expect(companyColor("other", "Nachbarfirma", null)).toBe("#64748b");
    // Interne Ansichten behalten ihre Firmenfarben, auch wenn das Portal-Branding orange ist.
    expect(companyColor("andere-id", "Kottke-Umzüge", null)).toBe("#1f3a5f");
    expect(companyColor("andere-id", "Ceylan Operations", null)).toBe("#ea580c");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { absoluteUrl, buildCalendarIcs } from "@/services/calendar/ics";
import { KOTTKE_COMPANY_ID } from "@/services/calendar/companies";
import { eventsFromDeal } from "@/services/calendar/map-events";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  listCalendarEvents: vi.fn(),
}));

vi.mock("@/services/calendar/feed-token-store", () => ({
  calendarFeeds: { authenticate: mocks.authenticate },
}));

vi.mock("@/services/calendar/load-events", () => ({
  listCalendarEvents: mocks.listCalendarEvents,
}));

import { GET } from "./route";

const TOKEN = "cal_abcdefghijklmnopqrst";
const ORIGIN = "https://crm.test";

function unfold(ics: string): string {
  return ics.replace(/\r\n[ \t]/g, "");
}

function uid(ics: string): string | null {
  return unfold(ics).match(/^UID:(.+)$/m)?.[1] ?? null;
}

const events = eventsFromDeal({
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
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({ workspaceId: "ws_kottke", userId: "usr_jonas", tokenId: "tok_1" });
  mocks.listCalendarEvents.mockResolvedValue({ events, companies: [], stages: [] });
});

describe("GET /api/calendar/ics/[token]", () => {
  it("behält die UID und zeigt im URL-Feld auf die Weiche", async () => {
    const res = await GET(new NextRequest(`${ORIGIN}/api/calendar/ics/${TOKEN}.ics`), {
      params: Promise.resolve({ token: `${TOKEN}.ics` }),
    });
    const body = await res.text();
    const plain = buildCalendarIcs(events, {
      calendarName: "Einsätze",
      dealUrl: (href) => absoluteUrl(ORIGIN, href),
    });

    expect(res.status).toBe(200);
    expect(uid(body)).toBe(uid(plain));
    expect(uid(body)).toBe("move-deal-1@umzug-suite");
    expect(unfold(body)).toContain("URL:https://crm.test/weiter?deal=deal-1");
    expect(unfold(plain)).toContain("URL:https://crm.test/objects/deals/deal-1");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  dealImWorkspace: vi.fn(),
  replaceDateOffers: vi.fn(),
  dbLesen: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: async () => {
            mocks.dbLesen();
            return [
              {
                id: "off_1",
                offerDate: "2026-11-21",
                slots: [{ label: "Vormittag", startTime: "08:00", endTime: "12:00" }],
                note: null,
                isRecommended: true,
                sortOrder: 0,
              },
            ];
          },
          limit: async () => {
            mocks.dbLesen();
            return [];
          },
        }),
      }),
    }),
  },
}));
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/lib/kalkulation-versionen-antwort", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/kalkulation-versionen-antwort")>();
  return { ...actual, dealImWorkspace: mocks.dealImWorkspace };
});
vi.mock("@/services/customer-portal-data", () => ({
  replaceDateOffers: mocks.replaceDateOffers,
  // Wie im Dienst: Termine aus einer Kalkulationsversion ändert nur der Termin-Dialog.
  TermineMitPreisError: class TermineMitPreisError extends Error {
    readonly code = "TERMINE_MIT_PREIS";
    constructor() {
      super("Termine mit Preis bitte im Termin-Dialog ändern.");
    }
  },
}));

import { DELETE, GET, PUT } from "./route";
import { TermineMitPreisError } from "@/services/customer-portal-data";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const URL_ = "http://localhost/api/v1/deals/deal_1/date-offers";
const p = () => ({ params: Promise.resolve({ recordId: "deal_1" }) });
const angebot = {
  date: "2026-11-21",
  slots: [{ label: "Vormittag", startTime: "08:00", endTime: "12:00" }],
  note: null,
  isRecommended: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.dealImWorkspace.mockResolvedValue(true);
  mocks.replaceDateOffers.mockResolvedValue({ count: 1 });
});

describe("GET /deals/[recordId]/date-offers", () => {
  it("Deal aus fremdem Workspace → 404, nichts gelesen", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    const res = await GET(new NextRequest(URL_), p());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toEqual({ code: "NOT_FOUND", message: "Deal nicht gefunden." });
    expect(mocks.dealImWorkspace).toHaveBeenCalledWith("ws_1", "deal_1");
    expect(mocks.dbLesen).not.toHaveBeenCalled();
  });

  it("liefert die Termine des Deals im Workspace", async () => {
    const res = await GET(new NextRequest(URL_), p());
    expect(res.status).toBe(200);
    expect((await res.json()).data.offers).toEqual([
      {
        id: "off_1",
        date: "2026-11-21",
        slots: [{ label: "Vormittag", startTime: "08:00", endTime: "12:00" }],
        note: null,
        isRecommended: true,
        sortOrder: 0,
      },
    ]);
    expect(mocks.dbLesen).toHaveBeenCalled();
  });
});

describe("PUT /deals/[recordId]/date-offers", () => {
  const put = (body: unknown) =>
    new NextRequest(URL_, {
      method: "PUT",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });

  it("Deal aus fremdem Workspace → 404, nichts geschrieben", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    const res = await PUT(put({ offers: [angebot] }), p());
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
    expect(mocks.replaceDateOffers).not.toHaveBeenCalled();
  });

  it("fremder Deal mit ungültigem JSON bleibt 404", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    const res = await PUT(put("kein json"), p());
    expect(res.status).toBe(404);
    expect(mocks.replaceDateOffers).not.toHaveBeenCalled();
  });

  it("ersetzt die Termine, wenn der Deal im Workspace liegt", async () => {
    const res = await PUT(put({ offers: [angebot] }), p());
    expect(res.status).toBe(200);
    expect(mocks.replaceDateOffers).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      dealRecordId: "deal_1",
      createdBy: "usr_1",
      offers: [{ date: "2026-11-21", slots: [{ label: "Vormittag", startTime: "08:00", endTime: "12:00" }], note: null, isRecommended: true }],
    });
  });
});

describe("Plan 5b: Termine aus einer Kalkulationsversion", () => {
  const put = (body: unknown) =>
    new NextRequest(URL_, { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

  it("PUT → 409 TERMINE_MIT_PREIS mit Hinweis auf den Termin-Dialog", async () => {
    mocks.replaceDateOffers.mockRejectedValue(new TermineMitPreisError());
    const res = await PUT(put({ offers: [angebot] }), p());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toEqual({ code: "TERMINE_MIT_PREIS", message: "Termine mit Preis bitte im Termin-Dialog ändern." });
  });

  it("DELETE → 409 TERMINE_MIT_PREIS", async () => {
    mocks.replaceDateOffers.mockRejectedValue(new TermineMitPreisError());
    const res = await DELETE(new NextRequest(URL_, { method: "DELETE" }), p());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("TERMINE_MIT_PREIS");
  });

  it("andere Fehler gehen weiter", async () => {
    mocks.replaceDateOffers.mockRejectedValue(new Error("kaputt"));
    await expect(PUT(put({ offers: [angebot] }), p())).rejects.toThrow("kaputt");
  });
});

describe("DELETE /deals/[recordId]/date-offers", () => {
  it("Deal aus fremdem Workspace → 404, nichts gelöscht", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    const res = await DELETE(new NextRequest(URL_, { method: "DELETE" }), p());
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
    expect(mocks.replaceDateOffers).not.toHaveBeenCalled();
  });

  it("leert die Termine des Deals im Workspace", async () => {
    const res = await DELETE(new NextRequest(URL_, { method: "DELETE" }), p());
    expect(res.status).toBe(200);
    expect(mocks.replaceDateOffers).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      dealRecordId: "deal_1",
      createdBy: "usr_1",
      offers: [],
    });
  });
});

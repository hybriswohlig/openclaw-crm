import { describe, expect, it } from "vitest";
import { berlinCalendarDay, explicitInvoiceDueDay, invoiceDueDay, restDueDay } from "./invoice-due-date";
import { faelligAm, ZAHLUNGSREGEL_STANDARD } from "./geld";

describe("invoiceDueDay", () => {
  it("uses the Europe/Berlin upload day, not UTC and not today + 7", () => {
    const lateUtc = new Date("2026-11-02T23:30:00.000Z");
    expect(berlinCalendarDay(lateUtc)).toBe("2026-11-03");
    expect(invoiceDueDay(undefined, lateUtc)).toBe("2026-11-03");
    expect(invoiceDueDay(undefined, lateUtc)).not.toBe("2026-11-09");

    const stillSecond = new Date("2026-11-02T22:30:00.000Z");
    expect(invoiceDueDay(null, stillSecond)).toBe("2026-11-02");
    expect(invoiceDueDay("", stillSecond)).toBe("2026-11-02");
    expect(invoiceDueDay("sofort", stillSecond)).toBe("2026-11-02");
  });

  it("uses the move day, and does not keep a later explicit day", () => {
    const now = new Date("2026-11-02T12:00:00.000Z");
    expect(restDueDay("2026-11-02", "2026-11-21")).toBe("2026-11-21");
    expect(restDueDay("2026-11-21", "2026-11-21")).toBe("2026-11-21");
    expect(restDueDay("2026-11-25", "2026-11-21")).toBe("2026-11-25");
    expect(invoiceDueDay(undefined, now, "2026-11-21")).toBe("2026-11-21");
    expect(invoiceDueDay("2026-12-01", now, "2026-11-21")).toBe("2026-11-21");
    expect(invoiceDueDay("2026-11-10", now, "2026-11-21")).toBe("2026-11-10");
    expect(invoiceDueDay("2026-12-01", now)).toBe("2026-11-02");
    expect(invoiceDueDay("01.11.2026", now)).toBe("2026-11-01");
    expect(explicitInvoiceDueDay("2026-02-31")).toBeNull();
    expect(invoiceDueDay("2026-02-31", now)).toBe("2026-11-02");
  });
});

describe("faelligAm", () => {
  const regel = { ...ZAHLUNGSREGEL_STANDARD, basis: "rechnungstag" as const, tage: 14 };

  it("ignores extra days and a Rechnungstag basis", () => {
    expect(faelligAm({ rechnungstag: "2026-11-02", umzugstag: "2026-11-21", regel })).toBe("2026-11-21");
    expect(faelligAm({ rechnungstag: "2026-11-25", umzugstag: "2026-11-21", regel })).toBe("2026-11-25");
    expect(faelligAm({ rechnungstag: "2026-11-02", umzugstag: null, regel })).toBe("2026-11-02");
    expect(
      faelligAm({ rechnungstag: "2026-11-02", umzugstag: "2026-11-21", regel, ausdruecklich: "2026-12-15" })
    ).toBe("2026-11-21");
  });
});

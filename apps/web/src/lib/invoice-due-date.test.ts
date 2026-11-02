import { describe, expect, it } from "vitest";
import { berlinCalendarDay, explicitInvoiceDueDay, invoiceDueDay } from "./invoice-due-date";

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

  it("keeps an explicit due date", () => {
    const now = new Date("2026-11-02T12:00:00.000Z");
    expect(invoiceDueDay("2026-12-01", now)).toBe("2026-12-01");
    expect(invoiceDueDay("2026-12-01T15:00:00.000Z", now)).toBe("2026-12-01");
    expect(invoiceDueDay("01.12.2026", now)).toBe("2026-12-01");
    expect(explicitInvoiceDueDay("2026-02-31")).toBeNull();
    expect(invoiceDueDay("2026-02-31", now)).toBe("2026-11-02");
  });
});

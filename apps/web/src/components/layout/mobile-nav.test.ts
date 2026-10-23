import { describe, expect, it } from "vitest";
import {
  isMobileNavActive,
  mobileMehrContains,
  mobileMehrItems,
  mobilePrimaryTabs,
} from "./mobile-nav";

describe("mobile bottom tabs", () => {
  it("shows Kalender in the slot Leads used to occupy, and keeps the Inbox badge", () => {
    expect(mobilePrimaryTabs.map((tab) => tab.label)).toEqual(["Heute", "Aufträge", "Inbox", "Kalender"]);
    expect(mobilePrimaryTabs.map((tab) => tab.href)).toEqual([
      "/home",
      "/operations",
      "/inbox",
      "/contract-calendar",
    ]);
    expect(mobilePrimaryTabs.find((tab) => tab.label === "Inbox")?.showBadge).toBe(true);
    expect(mobilePrimaryTabs.some((tab) => tab.label === "Leads")).toBe(false);
  });

  it("keeps Leads one tap away inside Mehr, where Kalender used to be", () => {
    expect(mobileMehrItems.map((item) => item.label)).toContain("Leads");
    expect(mobileMehrItems.find((item) => item.label === "Leads")?.href).toBe("/objects/deals");
    expect(mobileMehrItems.some((item) => item.href === "/contract-calendar")).toBe(false);
    expect(mobileMehrItems[2]).toMatchObject({ href: "/objects/deals", label: "Leads" });
    expect(mobileMehrItems.at(-1)).toMatchObject({ href: "/anrufe", label: "Anrufe" });
  });

  it("highlights Kalender on the calendar and Mehr on a lead, including a nested record", () => {
    expect(isMobileNavActive("/contract-calendar", "/contract-calendar")).toBe(true);
    expect(mobileMehrContains("/contract-calendar")).toBe(false);
    expect(isMobileNavActive("/objects/deals", "/objects/deals")).toBe(true);
    expect(isMobileNavActive("/objects/deals/abc", "/objects/deals")).toBe(true);
    expect(mobileMehrContains("/objects/deals/abc")).toBe(true);
    expect(mobilePrimaryTabs.some((tab) => isMobileNavActive("/objects/deals/abc", tab.href))).toBe(false);
  });
});

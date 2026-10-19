import { describe, expect, it } from "vitest";
import {
  UNSCHEDULED_KEY,
  compareByToday,
  groupByDay,
  pickDefaultDealIndex,
  resolveListAnchor,
} from "./list-anchor";

const TODAY = "2026-10-19";

describe("groupByDay", () => {
  it("keeps chronological groups and parks undated jobs at the end", () => {
    const groups = groupByDay(
      [
        { id: "u", date: null },
        { id: "oct", date: "2026-10-19" },
        { id: "may", date: "2026-05-13" },
        { id: "may-2", date: "2026-05-13" },
      ],
      (item) => item.date,
    );
    expect(groups.map((group) => group.dayKey)).toEqual(["2026-05-13", "2026-10-19", UNSCHEDULED_KEY]);
    expect(groups[0].items.map((item) => item.id)).toEqual(["may", "may-2"]);
  });
});

describe("resolveListAnchor", () => {
  it("anchors on today when that day has jobs", () => {
    expect(resolveListAnchor(["2026-05-13", "2026-10-19", "2026-11-02", UNSCHEDULED_KEY], TODAY)).toEqual({
      anchorDayKey: "2026-10-19",
      hasToday: true,
      pastDayCount: 1,
      marker: "on-today",
    });
  });

  it("anchors on the next upcoming day when today is empty", () => {
    expect(resolveListAnchor(["2026-05-13", "2026-05-20", "2026-10-23"], TODAY)).toEqual({
      anchorDayKey: "2026-10-23",
      hasToday: false,
      pastDayCount: 2,
      marker: "before-next",
    });
  });

  it("uses a trailing Heute marker when every dated job is in the past", () => {
    expect(resolveListAnchor(["2026-05-13", UNSCHEDULED_KEY], TODAY)).toEqual({
      anchorDayKey: null,
      hasToday: false,
      pastDayCount: 1,
      marker: "after-past",
    });
  });

  it("does not treat undated jobs as an upcoming day", () => {
    expect(resolveListAnchor([UNSCHEDULED_KEY], TODAY).marker).toBe("after-past");
    expect(resolveListAnchor([], TODAY)).toMatchObject({ anchorDayKey: null, pastDayCount: 0, marker: "after-past" });
  });
});

describe("compareByToday", () => {
  it("orders upcoming dates from today forward, then recent past, then undated", () => {
    const dates = ["2026-05-13", null, "2026-10-23", "2026-10-19", "2026-10-18", "2026-11-01"];
    expect([...dates].sort((a, b) => compareByToday(a, b, TODAY))).toEqual([
      "2026-10-19",
      "2026-10-23",
      "2026-11-01",
      "2026-10-18",
      "2026-05-13",
      null,
    ]);
  });
});

describe("pickDefaultDealIndex", () => {
  it("prefers a live job over the date order", () => {
    expect(
      pickDefaultDealIndex(
        [
          { moveDate: "2026-05-13" },
          { moveDate: "2026-10-19", live: true },
          { moveDate: "2026-10-20" },
        ],
        TODAY,
      ),
    ).toBe(1);
  });

  it("falls through to today or the next upcoming job, not the oldest", () => {
    expect(
      pickDefaultDealIndex(
        [{ moveDate: "2026-05-13" }, { moveDate: "2026-10-18" }, { moveDate: "2026-10-23" }],
        TODAY,
      ),
    ).toBe(2);
  });

  it("uses the most recent past job when nothing is left ahead", () => {
    expect(
      pickDefaultDealIndex([{ moveDate: "2026-05-13" }, { moveDate: "2026-10-18" }, { moveDate: null }], TODAY),
    ).toBe(1);
  });
});

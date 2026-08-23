import { describe, it, expect } from "vitest";
import {
  eurosToCents,
  centsToEuroInputValue,
  formatEURCents,
  formatDateDE,
  formatDayShortDE,
  deadlineLabel,
  daysBetweenDays,
  matchesOperativeFilter,
  matchesOverdueAreaFilter,
  operativeFilterChipCounts,
  operativeHeaderTotals,
  taskGroupKey,
  PROJECT_TASK_GROUP_KEY,
  buildDayColumns,
  todayColumnIndex,
  timelineBarStyle,
  assignBarLanes,
  activityTimelineType,
  groupBy,
  avatarOverflow,
  toDateInputValue,
  apiErrorMessage,
  countLabel,
  hasTimelineDate,
  toDate,
} from "./work-ui";
import { computeTimelineBar, phaseEndOffset } from "./work-metrics";

describe("formatters", () => {
  it("formats integer cents as whole euros", () => {
    expect(formatEURCents(125_000)).toContain("1.250");
    expect(formatEURCents(0)).toContain("0");
  });

  it("shows an en dash instead of a zero when there is no value", () => {
    expect(formatEURCents(null)).toBe("–");
    expect(formatDateDE(null)).toBe("–");
    expect(formatDayShortDE(undefined)).toBe("–");
  });

  it("formats an ISO string as a German date", () => {
    expect(formatDateDE("2025-07-14T00:00:00.000Z")).toMatch(/^\d{2}\.\d{2}\.2025$/);
  });
});

describe("deadlineLabel", () => {
  const now = new Date(2025, 6, 14); // 14 Jul 2025, local

  it("labels today and tomorrow", () => {
    expect(deadlineLabel(new Date(2025, 6, 14), { now })).toEqual({
      text: "Heute fällig",
      tone: "warn",
    });
    expect(deadlineLabel(new Date(2025, 6, 15), { now }).text).toBe("Morgen fällig");
  });

  it("counts overdue days and flags them danger", () => {
    const r = deadlineLabel(new Date(2025, 6, 11), { now });
    expect(r.text).toBe("3 Tage überfällig");
    expect(r.tone).toBe("danger");
    expect(deadlineLabel(new Date(2025, 6, 13), { now }).text).toBe("1 Tag überfällig");
  });

  it("never marks a completed task overdue", () => {
    expect(deadlineLabel(new Date(2025, 6, 1), { now, done: true }).tone).toBe("ok");
  });

  it("falls back to a plain date beyond a week", () => {
    expect(deadlineLabel(new Date(2025, 7, 30), { now }).tone).toBe("neutral");
  });
});

describe("daysBetweenDays", () => {
  it("counts whole calendar days regardless of the time of day", () => {
    const a = new Date(2025, 6, 14, 23, 59);
    const b = new Date(2025, 6, 15, 0, 1);
    expect(daysBetweenDays(a, b)).toBe(1);
  });
});

describe("matchesOperativeFilter", () => {
  // Monday 14 Jul 2025 → the week runs through Sunday 20 Jul.
  const now = new Date(2025, 6, 14);
  const task = (deadline: string | null, status = "geplant") => ({ deadline, status });

  it("heute matches only today", () => {
    expect(matchesOperativeFilter(task("2025-07-14T00:00:00"), "heute", now)).toBe(true);
    expect(matchesOperativeFilter(task("2025-07-15T00:00:00"), "heute", now)).toBe(false);
  });

  it("woche runs to the coming Sunday", () => {
    expect(matchesOperativeFilter(task("2025-07-20T00:00:00"), "woche", now)).toBe(true);
    expect(matchesOperativeFilter(task("2025-07-21T00:00:00"), "woche", now)).toBe(false);
  });

  it("ueberfaellig ignores completed tasks and undated tasks", () => {
    expect(matchesOperativeFilter(task("2025-07-10T00:00:00"), "ueberfaellig", now)).toBe(true);
    expect(matchesOperativeFilter(task("2025-07-10T00:00:00", "erledigt"), "ueberfaellig", now)).toBe(false);
    expect(matchesOperativeFilter(task(null), "ueberfaellig", now)).toBe(false);
  });

  it("alle lets everything through, dateless tasks included", () => {
    expect(matchesOperativeFilter(task(null), "alle", now)).toBe(true);
  });
});

describe("operativeFilterChipCounts", () => {
  // Monday 14 Jul 2025 → the week runs through Sunday 20 Jul.
  const now = new Date(2025, 6, 14);
  const task = (deadline: string | null, status = "geplant") => ({ deadline, status });

  it("I2: the Überfällig chip uses the honest all-kinds total, not the local operativ-only count", () => {
    const operativeTasks = [
      task("2025-07-10T00:00:00"), // 1 operativ task overdue locally
    ];
    // The dashboard tile counted 9 overdue tasks of every kind; only 1 of
    // them is operativ. The chip must show 9, not 1.
    const counts = operativeFilterChipCounts(operativeTasks, 9, now);
    const ueberfaellig = counts.find((c) => c.value === "ueberfaellig");
    expect(ueberfaellig?.count).toBe(9);
  });

  it("the other three chips keep counting the operativ-only population", () => {
    const operativeTasks = [
      task("2025-07-14T00:00:00"), // heute
      task("2025-07-16T00:00:00"), // woche
      task(null), // only "alle" catches this one
    ];
    const counts = operativeFilterChipCounts(operativeTasks, 9, now);
    expect(counts.find((c) => c.value === "heute")?.count).toBe(1);
    expect(counts.find((c) => c.value === "woche")?.count).toBe(2);
    expect(counts.find((c) => c.value === "alle")?.count).toBe(3);
  });

  // C2 (related): the Überfällig chip's count comes from a DIFFERENT
  // population (all kinds) than the operativ-only "Alle" chip beside it, so
  // a workspace with several overdue project tasks can show a larger
  // Überfällig number than "Alle" — legible via the label, not a defect.
  it("C2: labels the Überfällig chip as an all-kinds count, leaving the other three labels untouched", () => {
    const counts = operativeFilterChipCounts([task("2025-07-10T00:00:00")], 9, now);
    expect(counts.find((c) => c.value === "ueberfaellig")?.label).toBe("Überfällig (alle Arten)");
    expect(counts.find((c) => c.value === "alle")?.label).toBe("Alle");
    expect(counts.find((c) => c.value === "heute")?.label).toBe("Heute");
  });
});

describe("operativeHeaderTotals", () => {
  // C2: this reproduces the reported defect verbatim. 12 operativ tasks
  // loaded (7 erledigt, 5 open); filter="alle" renders all 12 rows
  // (matchesOperativeFilter("alle") lets completed tasks through), but the
  // header paired that with the completed-EXCLUDED operativeOpenTotal (5)
  // and printed "12 von 5". The true completed-inclusive total for the
  // SAME population "alle" renders is 12, so the fix must report 12, not 5.
  it("C2: pairs the Alle filter with the completed-inclusive total instead of the completed-excluded one", () => {
    const { loaded, total } = operativeHeaderTotals({
      filter: "alle",
      visibleCount: 12, // all 12 loaded tasks render under "alle"
      operativeAllTotal: 12, // true, completed-inclusive kind=operativ count
      operativeOpenTotal: 5, // true, completed-EXCLUDED count — must not be used here
      loadedOverdueAllCount: 0,
      overdueAllTotal: 0,
    });
    expect(loaded).toBe(12);
    expect(total).toBe(12);
    expect(loaded).toBeLessThanOrEqual(total);
  });

  it("C2: Alle still shows the 200-cap truncation when the true total exceeds what was loaded", () => {
    const { loaded, total } = operativeHeaderTotals({
      filter: "alle",
      visibleCount: 200,
      operativeAllTotal: 250,
      operativeOpenTotal: 40,
      loadedOverdueAllCount: 0,
      overdueAllTotal: 0,
    });
    expect(loaded).toBe(200);
    expect(total).toBe(250);
  });

  it("heute/woche keep pairing the visible rows with the true open total when nothing completed slips through", () => {
    const { loaded, total } = operativeHeaderTotals({
      filter: "heute",
      visibleCount: 3,
      operativeAllTotal: 47,
      operativeOpenTotal: 30, // honest, completed-excluded server count
      loadedOverdueAllCount: 0,
      overdueAllTotal: 0,
    });
    expect(loaded).toBe(3);
    expect(total).toBe(30);
  });

  // C2: matchesOperativeFilter does not exclude completed tasks for
  // "heute"/"woche" either, so a task completed today with today's deadline
  // can push `visible` above the completed-excluded operativeOpenTotal —
  // the same class of defect as the "alle" case, just rarer. The total must
  // never fall below what is actually rendered.
  it("heute/woche never report a total smaller than what is rendered, even if a completed task slips through", () => {
    const { loaded, total } = operativeHeaderTotals({
      filter: "woche",
      visibleCount: 8,
      operativeAllTotal: 47,
      operativeOpenTotal: 5,
      loadedOverdueAllCount: 0,
      overdueAllTotal: 0,
    });
    expect(loaded).toBe(8);
    expect(total).toBe(8);
    expect(loaded).toBeLessThanOrEqual(total);
  });

  it("switches to the all-kinds overdue total under the Überfällig filter, matching the KPI tile", () => {
    const { loaded, total } = operativeHeaderTotals({
      filter: "ueberfaellig",
      visibleCount: 12,
      operativeAllTotal: 12,
      operativeOpenTotal: 30,
      loadedOverdueAllCount: 9,
      overdueAllTotal: 9,
    });
    expect(loaded).toBe(9);
    expect(total).toBe(9);
  });
});

// C6: under the Überfällig filter (the only view mixing kind="projekt" into
// an otherwise operativ-only list), project tasks always have area=null —
// grouping bare `t.area ?? "sonstiges"` merged them into the SAME heading
// as genuine area="sonstiges"/area=null operativ tasks, two unrelated
// populations under one "Sonstiges" card.
describe("taskGroupKey", () => {
  it("gives every project task the same dedicated group key, regardless of its area", () => {
    expect(taskGroupKey({ kind: "projekt", area: null })).toBe(PROJECT_TASK_GROUP_KEY);
  });

  it("keeps grouping operativ tasks by area, falling back to sonstiges when unset", () => {
    expect(taskGroupKey({ kind: "operativ", area: "kunde" })).toBe("kunde");
    expect(taskGroupKey({ kind: "operativ", area: null })).toBe("sonstiges");
    expect(taskGroupKey({ kind: "operativ", area: "sonstiges" })).toBe("sonstiges");
  });

  it("never lets a project task collide with the genuine sonstiges group", () => {
    expect(taskGroupKey({ kind: "projekt", area: null })).not.toBe(
      taskGroupKey({ kind: "operativ", area: null }),
    );
  });
});

// C6: picking any Bereich in the dropdown used to silently drop every
// project task from the Überfällig view (they have no area to match
// against), even though the header still says "(alle Arten)".
describe("matchesOverdueAreaFilter", () => {
  it("never filters out a project task, no matter which Bereich is selected", () => {
    expect(matchesOverdueAreaFilter({ kind: "projekt", area: null }, "kunde")).toBe(true);
    expect(matchesOverdueAreaFilter({ kind: "projekt", area: null }, "")).toBe(true);
  });

  it("still filters operativ tasks by the selected Bereich", () => {
    expect(matchesOverdueAreaFilter({ kind: "operativ", area: "kunde" }, "kunde")).toBe(true);
    expect(matchesOverdueAreaFilter({ kind: "operativ", area: "auftrag" }, "kunde")).toBe(false);
  });

  it("lets every operativ task through when no Bereich is selected", () => {
    expect(matchesOverdueAreaFilter({ kind: "operativ", area: null }, "")).toBe(true);
    expect(matchesOverdueAreaFilter({ kind: "operativ", area: "kunde" }, "")).toBe(true);
  });
});

describe("buildDayColumns", () => {
  it("is inclusive on both ends", () => {
    const days = buildDayColumns(new Date(2025, 6, 14), new Date(2025, 6, 27));
    expect(days).toHaveLength(14);
    expect(days[0].getDate()).toBe(14);
    expect(days[13].getDate()).toBe(27);
  });

  it("returns a single column when start equals end", () => {
    expect(buildDayColumns(new Date(2025, 6, 14), new Date(2025, 6, 14))).toHaveLength(1);
  });

  it("crosses a month boundary", () => {
    const days = buildDayColumns(new Date(2025, 6, 30), new Date(2025, 7, 2));
    expect(days.map((d) => d.getDate())).toEqual([30, 31, 1, 2]);
  });
});

describe("todayColumnIndex", () => {
  it("finds today and returns -1 when today is outside the window", () => {
    const days = buildDayColumns(new Date(2025, 6, 14), new Date(2025, 6, 27));
    expect(todayColumnIndex(days, new Date(2025, 6, 16, 13, 30))).toBe(2);
    expect(todayColumnIndex(days, new Date(2025, 7, 1))).toBe(-1);
  });
});

describe("timelineBarStyle", () => {
  const DAY = 44;

  it("places a one-day bar inside its own column", () => {
    expect(timelineBarStyle({ startIndex: 0, endIndex: 0 }, DAY)).toEqual({ left: 3, width: 38 });
  });

  it("spans multiple columns inclusively", () => {
    expect(timelineBarStyle({ startIndex: 2, endIndex: 5 }, DAY)).toEqual({
      left: 2 * DAY + 3,
      width: 4 * DAY - 6,
    });
  });

  it("honours a custom inset", () => {
    expect(timelineBarStyle({ startIndex: 1, endIndex: 1 }, DAY, 0)).toEqual({ left: 44, width: 44 });
  });
});

describe("computeTimelineBar → pixel geometry", () => {
  const windowStart = new Date(2025, 6, 14);
  const windowEnd = new Date(2025, 6, 27);
  const DAY = 44;

  it("turns a dated task into a bar the grid can position", () => {
    const bar = computeTimelineBar(
      {
        id: "t1",
        startDate: new Date(2025, 6, 16),
        deadline: new Date(2025, 6, 18),
        createdAt: new Date(2025, 6, 10),
        status: "in_arbeit",
      },
      windowStart,
      windowEnd
    );
    expect(bar).not.toBeNull();
    expect(bar!.startIndex).toBe(2);
    expect(bar!.endIndex).toBe(4);
    expect(timelineBarStyle(bar!, DAY)).toEqual({ left: 2 * DAY + 3, width: 3 * DAY - 6 });
  });

  it("clips a task that starts before the window to column 0", () => {
    const bar = computeTimelineBar(
      {
        id: "t2",
        startDate: new Date(2025, 6, 1),
        deadline: new Date(2025, 6, 15),
        createdAt: new Date(2025, 6, 1),
        status: "geplant",
      },
      windowStart,
      windowEnd
    );
    expect(bar!.startIndex).toBe(0);
    expect(timelineBarStyle(bar!, DAY).left).toBe(3);
  });

  it("returns null for a task with no date at all", () => {
    // NOTE: the actual Phase-1 computeTimelineBar (lib/work-metrics.ts) does
    // NOT fall back to createdAt — a task with neither startDate nor
    // deadline returns null unconditionally, regardless of createdAt. The
    // implementation is normative, not the plan's original assumption; see
    // hasTimelineDate below, which mirrors this exact rule.
    const bar = computeTimelineBar(
      { id: "t3", startDate: null, deadline: null, createdAt: new Date(2025, 6, 16), status: "geplant" },
      windowStart,
      windowEnd
    );
    const outside = computeTimelineBar(
      { id: "t4", startDate: null, deadline: null, createdAt: new Date(2025, 0, 1), status: "geplant" },
      windowStart,
      windowEnd
    );
    expect(bar).toBeNull();
    expect(outside).toBeNull();
  });
});

describe("assignBarLanes", () => {
  it("keeps non-overlapping bars in one lane", () => {
    expect(
      assignBarLanes([
        { startIndex: 0, endIndex: 1 },
        { startIndex: 2, endIndex: 3 },
      ])
    ).toEqual([0, 0]);
  });

  it("pushes an overlapping bar into the next lane", () => {
    expect(
      assignBarLanes([
        { startIndex: 0, endIndex: 4 },
        { startIndex: 2, endIndex: 6 },
        { startIndex: 3, endIndex: 4 },
      ])
    ).toEqual([0, 1, 2]);
  });

  it("reuses a freed lane", () => {
    expect(
      assignBarLanes([
        { startIndex: 0, endIndex: 1 },
        { startIndex: 0, endIndex: 5 },
        { startIndex: 3, endIndex: 4 },
      ])
    ).toEqual([0, 1, 0]);
  });
});

describe("activityTimelineType", () => {
  it("maps the new project event types onto the timeline union", () => {
    expect(activityTimelineType("project.created")).toBe("created");
    expect(activityTimelineType("project.status_changed")).toBe("stage_changed");
    expect(activityTimelineType("task.moved_to_project")).toBe("task");
    expect(activityTimelineType("project.document_uploaded")).toBe("note");
    expect(activityTimelineType("something.unknown")).toBe("event");
  });

  it("never throws on a missing type — the whole project page renders through it", () => {
    // Regression guard for W2: an activity route returning raw rows (no
    // `type` field) must not take the page down with a TypeError.
    expect(activityTimelineType(undefined)).toBe("event");
    expect(activityTimelineType(null)).toBe("event");
    expect(activityTimelineType("")).toBe("event");
    expect(activityTimelineType(42 as unknown as string)).toBe("event");
  });
});

describe("toDateInputValue", () => {
  it("keeps the LOCAL day of a serialized UTC timestamp", () => {
    // 1 Sep 2026 at local midnight, serialized. In CEST this is
    // "2026-08-31T22:00:00.000Z" — a .slice(0, 10) would yield 31 Aug and
    // an onBlur handler would then write that wrong day back (W4).
    const local = new Date(2026, 8, 1);
    expect(toDateInputValue(local.toISOString())).toBe("2026-09-01");
  });

  it("round-trips a plain date string unchanged", () => {
    expect(toDateInputValue("2026-09-01T00:00:00")).toBe("2026-09-01");
  });

  it("returns an empty string for nothing, so the input stays blank", () => {
    expect(toDateInputValue(null)).toBe("");
    expect(toDateInputValue(undefined)).toBe("");
    expect(toDateInputValue("kaputt")).toBe("");
  });
});

describe("apiErrorMessage", () => {
  it("returns the German message the service produced", () => {
    expect(
      apiErrorMessage({ error: { code: "BAD_REQUEST", message: "Diese Abhängigkeit würde einen Kreis erzeugen." } }, "generisch")
    ).toBe("Diese Abhängigkeit würde einen Kreis erzeugen.");
  });

  it("falls back only when there is nothing to show", () => {
    expect(apiErrorMessage(null, "generisch")).toBe("generisch");
    expect(apiErrorMessage({}, "generisch")).toBe("generisch");
    expect(apiErrorMessage({ error: { message: "   " } }, "generisch")).toBe("generisch");
  });
});

describe("countLabel", () => {
  it("says so when the page is truncated", () => {
    expect(countLabel(200, 137)).toBe("137");
    expect(countLabel(200, 340)).toBe("200 von 340 geladen");
    expect(countLabel(12, 12)).toBe("12");
  });
});

describe("toDate", () => {
  it("parses a bare date string at LOCAL midnight, not UTC", () => {
    // new Date("2026-09-01") is UTC midnight — 31 Aug for anyone west of
    // Greenwich, which flips "overdue" a day early.
    const d = toDate("2026-09-01");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(8);
    expect(d!.getDate()).toBe(1);
    expect(d!.getHours()).toBe(0);
  });

  it("keeps the instant of a full ISO timestamp", () => {
    const local = new Date(2026, 8, 1, 14, 30);
    expect(toDate(local.toISOString())!.getTime()).toBe(local.getTime());
  });

  it("returns null for junk and for nothing", () => {
    expect(toDate("kaputt")).toBeNull();
    expect(toDate(null)).toBeNull();
  });
});

describe("phaseEndOffset", () => {
  it("is inclusive: a 14-day phase starting on day 0 ends on day 13", () => {
    expect(phaseEndOffset(0, 14)).toBe(13);
    expect(phaseEndOffset(14, 14)).toBe(27);
  });

  it("never returns an end before its start", () => {
    expect(phaseEndOffset(5, 0)).toBe(5);
    expect(phaseEndOffset(5, -3)).toBe(5);
  });

  it("rounds fractional durations rather than producing fractional days", () => {
    // The actual Phase-1 implementation (lib/work-metrics.ts) rounds the
    // duration, it does not truncate it: Math.round(7.9) = 8, so the phase
    // is treated as 8 days long and ends on offset 7, not 6.
    expect(phaseEndOffset(0, 7.9)).toBe(7);
  });
});

describe("hasTimelineDate", () => {
  it("never falls back to createdAt, exactly like computeTimelineBar does not", () => {
    // computeTimelineBar (lib/work-metrics.ts) returns null when neither
    // startDate nor deadline is set — createdAt is reserved and unread. This
    // predicate must agree, or a date-less task would count as "has a date"
    // while still getting no bar, vanishing from both the chart and the
    // "ohne Datum" tally at once.
    expect(
      hasTimelineDate({ startDate: null, deadline: null, createdAt: "2026-09-01T10:00:00.000Z" })
    ).toBe(false);
    expect(
      hasTimelineDate({ startDate: null, deadline: "2026-09-04", createdAt: "2026-09-01T10:00:00.000Z" })
    ).toBe(true);
  });
});

describe("eurosToCents", () => {
  // I3: German number format — "." is the thousands separator, "," is the
  // decimal separator, always. The pre-fix version got this backwards: it
  // only ever normalised the first comma, so a proper German thousands
  // amount like "12.500,00" failed to parse (reported as "no budget"), and a
  // plain "12.500" was misread as 12.5 -> 1250 cents, silently shrinking a
  // twelve-thousand-five-hundred-euro frame down to 12,50 €.
  it("parses a German comma decimal", () => {
    expect(eurosToCents("12,50")).toBe(1250);
  });

  it("parses a thousands-separated amount with decimals", () => {
    expect(eurosToCents("12.500,00")).toBe(1_250_000);
  });

  it("parses the same amount without the thousands separator", () => {
    expect(eurosToCents("12500,00")).toBe(1_250_000);
  });

  it("parses a whole-euro amount with a thousands separator and no decimals", () => {
    // The headline bug: this used to silently become 12,50 EUR (1250 cents).
    expect(eurosToCents("12.500")).toBe(1_250_000);
  });

  it("parses a whole-euro amount with no separator at all", () => {
    expect(eurosToCents("12500")).toBe(1_250_000);
  });

  it("parses an amount with multiple thousands separators", () => {
    expect(eurosToCents("1.234.567,89")).toBe(123_456_789);
  });

  it("strips a leading or trailing € and surrounding whitespace", () => {
    expect(eurosToCents("€ 12.500,00")).toBe(1_250_000);
    expect(eurosToCents("12.500,00 €")).toBe(1_250_000);
    expect(eurosToCents("  12500  ")).toBe(1_250_000);
  });

  it("parses a whole number with no decimal part", () => {
    expect(eurosToCents("5000")).toBe(500_000);
  });

  it("returns null for an empty or whitespace-only string", () => {
    expect(eurosToCents("")).toBeNull();
    expect(eurosToCents("   ")).toBeNull();
  });

  it("rejects an unparseable string rather than treating it as an empty budget", () => {
    // The other half of I3: this must NOT be conflated with "cleared" by the
    // caller. eurosToCents still answers null for both cases — it is
    // budget-tab.tsx's saveFrame that is responsible for telling a blank
    // string apart from a rejected one before it decides whether to PATCH.
    expect(eurosToCents("abc")).toBeNull();
    expect(eurosToCents("12,50,00")).toBeNull();
    expect(eurosToCents("12,5x")).toBeNull();
  });

  it("rounds to the nearest cent", () => {
    expect(eurosToCents("12,345")).toBe(1235);
  });

  it("handles zero and negative amounts", () => {
    expect(eurosToCents("0")).toBe(0);
    expect(eurosToCents("-5,50")).toBe(-550);
  });

  // I9: a thousands group must be EXACTLY three digits. "12.500" is a valid
  // German amount; "12.50" is not — it must be rejected (null), not
  // reinterpreted as 12,50. Guessing turned "twelve fifty" into 1250 EUR,
  // a hundred times too large, which is the exact data-loss class I3 was
  // fixing in the first place.
  it("accepts a whole thousands-grouped amount, with or without a decimal comma", () => {
    expect(eurosToCents("12.500")).toBe(1_250_000);
    expect(eurosToCents("12.500,00")).toBe(1_250_000);
  });

  it("accepts a plain comma decimal and a plain ungrouped integer", () => {
    expect(eurosToCents("12,50")).toBe(1250);
    expect(eurosToCents("12500")).toBe(1_250_000);
  });

  it("accepts multiple three-digit thousands groups", () => {
    expect(eurosToCents("1.234.567,89")).toBe(123_456_789);
  });

  it("rejects a malformed dot-group instead of guessing it means a decimal", () => {
    // Two digits after the dot — not a valid thousands group.
    expect(eurosToCents("12.50")).toBeNull();
    // Four digits after the dot.
    expect(eurosToCents("1.2345")).toBeNull();
    // A valid first group followed by a malformed one.
    expect(eurosToCents("12.500.00")).toBeNull();
  });
});

// C3: budget-tab.tsx used to seed its "Rahmen in EUR" input with
// `String(planned / 100)`, which for a fractional cents value (e.g.
// 1.250.050 cents) renders a period decimal ("12500.5") — text eurosToCents
// itself rejects, since "." is ALWAYS a German thousands separator to it.
// Focusing the untouched, application-written field and tabbing out then
// showed "Betrag konnte nicht gelesen werden…". centsToEuroInputValue must
// round-trip through eurosToCents for every cents value the app can store.
describe("centsToEuroInputValue", () => {
  it("returns an empty string for null/undefined (no budget set)", () => {
    expect(centsToEuroInputValue(null)).toBe("");
    expect(centsToEuroInputValue(undefined)).toBe("");
  });

  it("round-trips through eurosToCents for a fractional amount", () => {
    const formatted = centsToEuroInputValue(1_250_050);
    expect(eurosToCents(formatted)).toBe(1_250_050);
  });

  it("round-trips through eurosToCents for one cent", () => {
    const formatted = centsToEuroInputValue(1);
    expect(eurosToCents(formatted)).toBe(1);
  });

  it("round-trips through eurosToCents for zero", () => {
    const formatted = centsToEuroInputValue(0);
    expect(eurosToCents(formatted)).toBe(0);
  });

  it("round-trips a whole-euro amount too", () => {
    const formatted = centsToEuroInputValue(1_250_000);
    expect(eurosToCents(formatted)).toBe(1_250_000);
  });
});

describe("groupBy / avatarOverflow", () => {
  it("groups in first-seen order", () => {
    const groups = groupBy([{ a: "x" }, { a: "y" }, { a: "x" }], (i) => i.a);
    expect(groups.map((g) => g.key)).toEqual(["x", "y"]);
    expect(groups[0].items).toHaveLength(2);
  });

  it("counts the hidden avatars", () => {
    expect(avatarOverflow(5, 3)).toBe(2);
    expect(avatarOverflow(2, 3)).toBe(0);
  });
});

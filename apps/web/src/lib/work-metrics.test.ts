import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  progressPct,
  isOverdue,
  daysOverdue,
  budgetPct,
  computeTimelineBar,
  offsetDaysToDate,
  parseDateColumn,
  toIsoDay,
  phaseEndOffset,
} from "./work-metrics";

// The sprint window used by every timeline case: Mon 17.08.2026 – Sun 30.08.2026,
// i.e. 14 day columns with indexes 0..13.
const WINDOW_START = new Date(2026, 7, 17);
const WINDOW_END = new Date(2026, 7, 30);
const NOW = new Date(2026, 7, 21, 9, 30);

type TimelineTask = Parameters<typeof computeTimelineBar>[0];

function task(partial: Partial<TimelineTask>): TimelineTask {
  return {
    id: "t1",
    startDate: null,
    deadline: null,
    createdAt: new Date(2026, 7, 1),
    status: "geplant",
    ...partial,
  };
}

describe("progressPct", () => {
  it("is 0 when there is nothing to do", () => {
    expect(progressPct(0, 0)).toBe(0);
    expect(progressPct(5, 0)).toBe(0);
  });

  it("reproduces the mockup: 18 of 31 tasks is 58 percent", () => {
    expect(progressPct(18, 31)).toBe(58);
  });

  it("rounds to whole percent", () => {
    expect(progressPct(1, 3)).toBe(33);
    expect(progressPct(2, 3)).toBe(67);
  });

  it("clamps to 0..100", () => {
    expect(progressPct(5, 5)).toBe(100);
    expect(progressPct(7, 5)).toBe(100);
    expect(progressPct(-2, 5)).toBe(0);
  });
});

describe("isOverdue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is true for a deadline before today and an unfinished task", () => {
    expect(isOverdue(new Date(2026, 7, 20, 23, 59), "geplant")).toBe(true);
    expect(isOverdue(new Date(2026, 7, 18), "in_arbeit")).toBe(true);
  });

  it("is false on the deadline day itself", () => {
    expect(isOverdue(new Date(2026, 7, 21, 0, 0), "geplant")).toBe(false);
    expect(isOverdue(new Date(2026, 7, 21, 23, 59), "in_arbeit")).toBe(false);
  });

  it("is false for a finished task no matter how old the deadline is", () => {
    expect(isOverdue(new Date(2025, 0, 1), "erledigt")).toBe(false);
  });

  it("is false without a deadline", () => {
    expect(isOverdue(null, "geplant")).toBe(false);
  });
});

describe("daysOverdue", () => {
  it("counts whole days since the deadline", () => {
    expect(daysOverdue(new Date(2026, 7, 18), NOW)).toBe(3);
    expect(daysOverdue(new Date(2026, 7, 20, 22, 0), NOW)).toBe(1);
  });

  it("is 0 today, in the future and without a deadline", () => {
    expect(daysOverdue(new Date(2026, 7, 21, 6, 0), NOW)).toBe(0);
    expect(daysOverdue(new Date(2026, 7, 25), NOW)).toBe(0);
    expect(daysOverdue(null, NOW)).toBe(0);
  });

  it("survives the end of summer time", () => {
    // 25.10.2026 is the DST switch in Europe/Berlin: that day has 25 hours.
    expect(daysOverdue(new Date(2026, 9, 23), new Date(2026, 9, 27, 12, 0))).toBe(4);
  });

  it("survives the start of summer time", () => {
    // 29.03.2026 is the DST switch in Europe/Berlin: that day has only 23
    // hours, so 27.03. -> 31.03. is 95h = 3.9583 days. Math.floor would give
    // 3; only Math.round gives the correct 4.
    expect(daysOverdue(new Date(2026, 2, 27), new Date(2026, 2, 31, 12, 0))).toBe(4);
  });
});

describe("budgetPct", () => {
  it("is the spend over the frame, in whole percent", () => {
    expect(budgetPct(450_000, 1_000_000)).toBe(45);
    expect(budgetPct(0, 1_000_000)).toBe(0);
  });

  it("goes past 100 so overspend stays visible", () => {
    expect(budgetPct(1_250_000, 1_000_000)).toBe(125);
  });

  it("is null without a usable frame, so the UI shows no percentage", () => {
    expect(budgetPct(500, null)).toBeNull();
    expect(budgetPct(500, 0)).toBeNull();
    expect(budgetPct(500, -100)).toBeNull();
  });
});

describe("computeTimelineBar", () => {
  it("draws nothing for a task without any date", () => {
    expect(computeTimelineBar(task({}), WINDOW_START, WINDOW_END, NOW)).toBeNull();
  });

  it("draws a one day bar when only the deadline is known", () => {
    expect(
      computeTimelineBar(task({ deadline: new Date(2026, 7, 25) }), WINDOW_START, WINDOW_END, NOW)
    ).toEqual({ taskId: "t1", startIndex: 8, endIndex: 8, state: "geplant" });
  });

  it("draws a one day bar when only the start date is known", () => {
    // Operative tasks routinely have a start and no deadline. The bar must
    // still land on the start day instead of vanishing off the window.
    expect(
      computeTimelineBar(
        task({ startDate: new Date(2026, 7, 19) }),
        WINDOW_START,
        WINDOW_END,
        NOW
      )
    ).toEqual({ taskId: "t1", startIndex: 2, endIndex: 2, state: "geplant" });
  });

  it("spans from start date to deadline", () => {
    expect(
      computeTimelineBar(
        task({
          startDate: new Date(2026, 7, 18),
          deadline: new Date(2026, 7, 22),
          status: "in_arbeit",
        }),
        WINDOW_START,
        WINDOW_END,
        NOW
      )
    ).toEqual({ taskId: "t1", startIndex: 1, endIndex: 5, state: "in_arbeit" });
  });

  it("clamps a start that lies after the deadline onto the deadline", () => {
    expect(
      computeTimelineBar(
        task({ startDate: new Date(2026, 7, 25), deadline: new Date(2026, 7, 24) }),
        WINDOW_START,
        WINDOW_END,
        NOW
      )
    ).toEqual({ taskId: "t1", startIndex: 7, endIndex: 7, state: "geplant" });
  });

  it("draws nothing when the bar lies entirely outside the window", () => {
    expect(
      computeTimelineBar(
        task({ startDate: new Date(2026, 7, 5), deadline: new Date(2026, 7, 10) }),
        WINDOW_START,
        WINDOW_END,
        NOW
      )
    ).toBeNull();
    expect(
      computeTimelineBar(
        task({ startDate: new Date(2026, 8, 2), deadline: new Date(2026, 8, 5) }),
        WINDOW_START,
        WINDOW_END,
        NOW
      )
    ).toBeNull();
  });

  it("clips a bar that only partly overlaps the window", () => {
    expect(
      computeTimelineBar(
        task({
          startDate: new Date(2026, 7, 12),
          deadline: new Date(2026, 7, 19),
          status: "in_arbeit",
        }),
        WINDOW_START,
        WINDOW_END,
        NOW
      )
      // The deadline (19.08.) is already behind NOW (21.08.), so the clipped
      // bar is also overdue.
    ).toEqual({ taskId: "t1", startIndex: 0, endIndex: 2, state: "ueberfaellig" });

    expect(
      computeTimelineBar(
        task({ startDate: new Date(2026, 7, 28), deadline: new Date(2026, 8, 4) }),
        WINDOW_START,
        WINDOW_END,
        NOW
      )
    ).toEqual({ taskId: "t1", startIndex: 11, endIndex: 13, state: "geplant" });
  });

  it("derives the four bar states", () => {
    const done = computeTimelineBar(
      task({ deadline: new Date(2026, 7, 18), status: "erledigt" }),
      WINDOW_START,
      WINDOW_END,
      NOW
    );
    expect(done?.state).toBe("erledigt");

    const late = computeTimelineBar(
      task({ deadline: new Date(2026, 7, 18), status: "in_arbeit" }),
      WINDOW_START,
      WINDOW_END,
      NOW
    );
    expect(late?.state).toBe("ueberfaellig");

    const running = computeTimelineBar(
      task({ deadline: new Date(2026, 7, 28), status: "in_arbeit" }),
      WINDOW_START,
      WINDOW_END,
      NOW
    );
    expect(running?.state).toBe("in_arbeit");

    const planned = computeTimelineBar(
      task({ deadline: new Date(2026, 7, 28), status: "geplant" }),
      WINDOW_START,
      WINDOW_END,
      NOW
    );
    expect(planned?.state).toBe("geplant");
  });

  it("keeps the task id so the SVG overlay can find its bar", () => {
    const bar = computeTimelineBar(
      task({ id: "task-42", deadline: new Date(2026, 7, 19) }),
      WINDOW_START,
      WINDOW_END,
      NOW
    );
    expect(bar?.taskId).toBe("task-42");
  });
});

describe("offsetDaysToDate", () => {
  it("turns the AI planner's day offsets into local midnight dates", () => {
    expect(offsetDaysToDate(new Date(2026, 7, 21, 14, 30), 0)).toEqual(new Date(2026, 7, 21));
    expect(offsetDaysToDate(new Date(2026, 7, 21), 10)).toEqual(new Date(2026, 7, 31));
    expect(offsetDaysToDate(new Date(2026, 7, 21), -1)).toEqual(new Date(2026, 7, 20));
  });

  it("crosses month and summer time boundaries", () => {
    expect(offsetDaysToDate(new Date(2026, 7, 28), 7)).toEqual(new Date(2026, 8, 4));
    expect(offsetDaysToDate(new Date(2026, 9, 24), 7)).toEqual(new Date(2026, 9, 31));
  });
});

describe("parseDateColumn — local midnight, never UTC", () => {
  it("returns null for null", () => {
    expect(parseDateColumn(null)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseDateColumn("")).toBeNull();
  });

  it("parses YYYY-MM-DD at LOCAL midnight, not UTC midnight", () => {
    const d = parseDateColumn("2026-08-21");
    expect(d).not.toBeNull();
    // The whole point: in CET/CEST `new Date("2026-08-21")` would be
    // 2026-08-21T00:00Z === 02:00 local, and any later UTC-based
    // formatting of a date built that way can slip a day. We want the
    // calendar day the database wrote, in the viewer's own timezone.
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(7); // 0-indexed August
    expect(d!.getDate()).toBe(21);
    expect(d!.getHours()).toBe(0);
    expect(d!.getMinutes()).toBe(0);
    expect(d!.getSeconds()).toBe(0);
    expect(d!.getMilliseconds()).toBe(0);
  });

  it("parses at an epoch distinct from a UTC-midnight parse of the same string", () => {
    // The discriminating assertion, stated as an epoch relationship instead
    // of just checking Date components (which a UTC-pinned test runner can
    // satisfy vacuously — see the vitest.config.ts TZ pin and its comment).
    // A buggy `v => new Date(v)` implementation returns UTC midnight for
    // this string: exactly `new Date("2026-08-21").getTime()`. The correct
    // implementation must NOT match that: local midnight in Berlin summer
    // (CEST, UTC+2) is 2026-08-20T22:00:00Z, two hours EARLIER.
    const local = parseDateColumn("2026-08-21")!;
    const utcMidnight = new Date("2026-08-21");
    expect(utcMidnight.getTime() - local.getTime()).toBe(2 * 60 * 60 * 1000);
    expect(local.getTime()).not.toBe(utcMidnight.getTime());
  });

  it("round-trips every day of a month without drifting", () => {
    for (let day = 1; day <= 31; day++) {
      const iso = `2026-01-${String(day).padStart(2, "0")}`;
      expect(parseDateColumn(iso)!.getDate()).toBe(day);
    }
  });

  it("ignores a timestamp suffix and keeps the calendar day", () => {
    expect(parseDateColumn("2026-12-31T23:30:00.000Z")!.getDate()).toBe(31);
  });

  it("returns null for a malformed value rather than an Invalid Date", () => {
    expect(parseDateColumn("nope")).toBeNull();
    expect(parseDateColumn("2026-13-45")).toBeNull();
  });
});

describe("toIsoDay — the string a `date` column is compared against", () => {
  it("formats a local date as YYYY-MM-DD", () => {
    expect(toIsoDay(new Date(2026, 7, 21, 10, 30))).toBe("2026-08-21");
  });

  it("zero-pads month and day", () => {
    expect(toIsoDay(new Date(2026, 0, 5, 0, 0))).toBe("2026-01-05");
  });

  it("uses the LOCAL day, not the UTC day — discriminates specifically EAST of Greenwich", () => {
    // Berlin is EAST of Greenwich (positive UTC offset), so the local-vs-UTC
    // day mismatch shows up at the START of the local day, not the end. An
    // earlier version of this test used 2026-08-21 23:30 local, on the
    // (backwards) theory that a late evening pushes into the next UTC day —
    // but for a positive offset, UTC is BEHIND local, so a late local time
    // still lands on the SAME UTC day here: `new Date(2026,7,21,23,30)`
    // is 2026-08-21T21:30Z. That version silently passed under a
    // `d.toISOString().slice(0,10)` implementation too, so it never caught
    // anything.
    //
    // An EARLY local time is what discriminates east of Greenwich: shortly
    // after midnight, UTC is still on the PREVIOUS calendar day. Using
    // 2026-10-25 00:30 (still CEST, the last few hours before that day's DST
    // fallback) keeps this next to the DST-switch date used elsewhere.
    expect(toIsoDay(new Date(2026, 9, 25, 0, 30))).toBe("2026-10-25");
    // Spelled out: this is exactly what `toISOString().slice(0, 10)` would
    // get wrong — one day early.
    expect(new Date(2026, 9, 25, 0, 30).toISOString().slice(0, 10)).toBe("2026-10-24");
  });

  it("is the exact inverse of parseDateColumn", () => {
    // Kept as a consistency check, but by itself this test CANNOT catch a
    // UTC-based bug: a self-consistent UTC pair (`v => new Date(v)` /
    // `d => d.toISOString().slice(0, 10)`) round-trips exactly as cleanly as
    // the correct local pair, for every input, in any single fixed
    // timezone — a round-trip is a logical necessity of self-consistency,
    // not evidence of correctness. The tests that actually discriminate a
    // UTC implementation are "parses at an epoch distinct from..." above
    // and "uses the LOCAL day, not the UTC day" above.
    for (const iso of [
      "2026-01-01",
      "2026-02-28",
      "2026-03-29",
      "2026-08-21",
      "2026-10-25",
      "2026-12-31",
    ]) {
      expect(toIsoDay(parseDateColumn(iso)!)).toBe(iso);
    }
  });
});

describe("phaseEndOffset — inclusive, and the only copy of this formula", () => {
  it("a 14-day phase starting on day 0 ends on day 13, not day 14", () => {
    // Inclusive: starting on the 1st, a 14-day phase ends on the 14th.
    expect(phaseEndOffset(0, 14)).toBe(13);
  });

  it("carries the start offset through", () => {
    expect(phaseEndOffset(7, 14)).toBe(20);
    expect(phaseEndOffset(30, 1)).toBe(30);
  });

  it("a one-day phase starts and ends on the same day", () => {
    expect(phaseEndOffset(5, 1)).toBe(5);
  });

  it("clamps a zero or negative duration to one day", () => {
    // The AI generator's schema defaults durationDays to 7 and floors it at
    // 1, but a hand-built payload can still send 0 — which without the clamp
    // would put the end BEFORE the start.
    expect(phaseEndOffset(5, 0)).toBe(5);
    expect(phaseEndOffset(5, -3)).toBe(5);
  });

  it("never returns an end before the start", () => {
    for (const d of [-10, 0, 1, 2, 90]) {
      expect(phaseEndOffset(12, d)).toBeGreaterThanOrEqual(12);
    }
  });
});

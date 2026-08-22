import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  progressPct,
  isOverdue,
  daysOverdue,
  budgetPct,
  computeTimelineBar,
  offsetDaysToDate,
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

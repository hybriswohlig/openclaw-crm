import { describe, expect, it } from "vitest";
import * as events from "./activity-events";
import { PROJECT_EVENT_TYPES, type ActivityEventType } from "./activity-events";

// The Projekte module writes into the existing activity_events table
// (record_id has no FK, so it can hold a projects.id — spec §10.1). This
// guards the closed union against a silently dropped literal.
describe("PROJECT_EVENT_TYPES", () => {
  it("lists the 14 literals of spec §10.1 plus project.member_role_changed", () => {
    // The 15th closes a spec gap: promoting somebody to 'leiter' is the
    // membership change most worth having a record of, and it was the only
    // one that left no trace at all.
    expect([...PROJECT_EVENT_TYPES]).toEqual([
      "project.created",
      "project.updated",
      "project.status_changed",
      "project.member_added",
      "project.member_removed",
      "project.member_role_changed",
      "project.phase_created",
      "project.phase_completed",
      "project.milestone_reached",
      "project.risk_opened",
      "project.risk_closed",
      "project.document_uploaded",
      "project.budget_entry_added",
      "task.moved_to_project",
      "task.status_changed",
    ]);
  });

  it("keeps them assignable to ActivityEventType", () => {
    const sample: ActivityEventType[] = [
      "project.created",
      "project.milestone_reached",
      "task.moved_to_project",
    ];
    expect(sample).toHaveLength(3);
  });

  it("does not collide with the pre-existing deal literals", () => {
    expect(PROJECT_EVENT_TYPES).not.toContain("deal.stage_changed" as ActivityEventType);
  });
});

describe("the two emitters are separate", () => {
  it("exports a record-only path AND a notify path", () => {
    // recordProjectEvent writes the activity row only; notifyProjectEvent
    // adds the member fan-out. Only the four triggers of spec §10.2 may use
    // the second one — a single combined helper would fan the Notizen
    // autosave out to every member on every keystroke burst.
    expect(typeof events.recordProjectEvent).toBe("function");
    expect(typeof events.notifyProjectEvent).toBe("function");
    expect(events.recordProjectEvent).not.toBe(events.notifyProjectEvent);
  });
});

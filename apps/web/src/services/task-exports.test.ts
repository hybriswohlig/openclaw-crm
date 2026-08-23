import { describe, expect, it } from "vitest";
import * as taskComments from "./task-comments";
import * as taskNotifications from "./task-notifications";

// The two drizzle re-exports were dead weight: nothing ever imported `desc`
// from task-comments or `eq`/`inArray` from task-notifications (spec §7).
describe("no drizzle operators leak out of the task services", () => {
  it("task-comments does not re-export desc", () => {
    expect("desc" in taskComments).toBe(false);
  });

  it("task-notifications does not re-export eq or inArray", () => {
    expect("eq" in taskNotifications).toBe(false);
    expect("inArray" in taskNotifications).toBe(false);
  });

  it("both still export their real API", () => {
    expect(typeof taskComments.listTaskComments).toBe("function");
    expect(typeof taskNotifications.notifyTaskAssigned).toBe("function");
    expect(typeof taskNotifications.describeTaskChange).toBe("function");
  });
});

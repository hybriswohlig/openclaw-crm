import { afterEach, describe, expect, it, vi } from "vitest";
import { TASK_LINK_PARAM, fetchLinkedTask, taskLinkUrl } from "./task-link";
import type { TaskJSON } from "./work-types";

// Task pushes link to /tasks?taskId=<id>, but no page read that parameter, so
// a tap only opened the dashboard. The dashboard now reads TASK_LINK_PARAM,
// loads the task via GET /api/v1/tasks/<id> and opens its dialog.

const TASK: TaskJSON = {
  id: "b1c2d3e4-0000-4000-8000-000000000001",
  content: "Kartons zum Kunden bringen",
  deadline: "2026-10-09T21:59:00.000Z",
  isCompleted: false,
  completedAt: null,
  createdBy: "user-1",
  createdAt: "2026-10-01T08:00:00.000Z",
  linkedRecords: [],
  assignees: [{ id: "user-2", name: "Max Muster", email: "max@example.test" }],
  sprintId: null,
  description: null,
  priority: null,
  parentTaskId: null,
  kind: "operativ",
  projectId: null,
  projectName: null,
  phaseId: null,
  area: null,
  status: "geplant",
  startDate: null,
};

function antwort(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("taskLinkUrl", () => {
  it("links to the dashboard with the parameter the page reads", () => {
    const url = taskLinkUrl(TASK.id);
    expect(url).toBe(`/tasks?taskId=${TASK.id}`);
    const parsed = new URL(url, "https://crm.test");
    expect(parsed.pathname).toBe("/tasks");
    expect(parsed.searchParams.get(TASK_LINK_PARAM)).toBe(TASK.id);
  });

  it("encodes the id so it arrives unchanged", () => {
    const url = taskLinkUrl("a&b=c d");
    expect(url).toBe("/tasks?taskId=a%26b%3Dc%20d");
    expect(new URL(url, "https://crm.test").searchParams.get(TASK_LINK_PARAM)).toBe("a&b=c d");
  });
});

describe("fetchLinkedTask", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the single task route without cache and returns the task", async () => {
    const fetchMock = vi.fn().mockResolvedValue(antwort(200, { data: TASK }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchLinkedTask(TASK.id)).resolves.toEqual(TASK);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/tasks/${TASK.id}`,
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("encodes the id in the route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(antwort(200, { data: TASK }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchLinkedTask("a/b");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/tasks/a%2Fb", expect.anything());
  });

  it("returns null for a task that no longer exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(antwort(404, { error: { code: "NOT_FOUND", message: "Task not found" } })),
    );
    await expect(fetchLinkedTask(TASK.id)).resolves.toBeNull();
  });

  it("throws on other HTTP errors instead of reporting the task as gone", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(antwort(500, { error: { code: "INTERNAL_ERROR" } })));
    await expect(fetchLinkedTask(TASK.id)).rejects.toThrow("Aufgabe konnte nicht geladen werden (500)");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(antwort(401, { error: { code: "UNAUTHORIZED" } })));
    await expect(fetchLinkedTask(TASK.id)).rejects.toThrow("(401)");
  });

  it("throws without a connection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(fetchLinkedTask(TASK.id)).rejects.toThrow();
  });

  it("throws on a response without a task", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })));
    await expect(fetchLinkedTask(TASK.id)).rejects.toThrow("ungültige Antwort");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(antwort(200, { data: null })));
    await expect(fetchLinkedTask(TASK.id)).rejects.toThrow("ungültige Antwort");
  });
});

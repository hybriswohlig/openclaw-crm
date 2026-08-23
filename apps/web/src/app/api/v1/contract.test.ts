import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// F7: one file that mechanically asserts the wire contract (query-param
// defaults/caps and response envelope shapes) across the routes Phase 3
// (MCP tools) and Phase 4 (UI) are built against — NOT handler tests for
// every route. Six of the eight Phase 2 review findings lived in exactly
// this layer (the route, or the seam between a route and its caller), and
// both route-level Criticals that phase produced were found by human review
// rather than by a test.
//
// Same technique as app/api/v1/inbox/attachments/[id]/route.test.ts: mock
// only the DB-touching service seam (never @/db itself — `db` is a lazy
// Proxy, see apps/web/src/db/index.ts, so importing it is safe, but no test
// here may let a query actually run), keep the real getAuthContext/
// unauthorized/notFound/badRequest/success from @/lib/api-utils via
// importOriginal so the status codes and envelopes under test are the ones
// production ships.
const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  listTasks: vi.fn(),
  getActiveSprint: vi.fn(),
  listProjects: vi.fn(),
  getProject: vi.fn(),
  getSprintTimeline: vi.fn(),
  generateProjectPlan: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/services/tasks", async (importOriginal) => {
  // Keep the real (pure) helpers — planTaskFilters, describeTaskRouteError,
  // TaskInvariantError etc. — and swap out only the DB-touching entry point
  // GET /tasks calls.
  const actual = await importOriginal<typeof import("@/services/tasks")>();
  return { ...actual, listTasks: mocks.listTasks };
});

vi.mock("@/services/sprints", () => ({
  getActiveSprint: mocks.getActiveSprint,
}));

vi.mock("@/services/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/projects")>();
  return { ...actual, listProjects: mocks.listProjects, getProject: mocks.getProject };
});

vi.mock("@/services/work-dashboard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/work-dashboard")>();
  return { ...actual, getSprintTimeline: mocks.getSprintTimeline };
});

vi.mock("@/services/project-plan-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/project-plan-ai")>();
  return { ...actual, generateProjectPlan: mocks.generateProjectPlan };
});

import { GET as tasksGET } from "./tasks/route";
import { GET as projectsGET } from "./projects/route";
import { GET as projectDetailGET } from "./projects/[projectId]/route";
import { GET as timelineGET } from "./work/timeline/route";
import { POST as planGeneratePOST } from "./projects/plan-generate/route";

const WORKSPACE_ID = "ws_kottke_prod";
const AUTH_CTX = {
  userId: "usr_1",
  workspaceId: WORKSPACE_ID,
  workspaceRole: "admin" as const,
  permissions: {},
  authMethod: "api_key" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(AUTH_CTX);
  mocks.listTasks.mockResolvedValue({ tasks: [], total: 0 });
  mocks.listProjects.mockResolvedValue({ projects: [], total: 0 });
  mocks.getSprintTimeline.mockResolvedValue({ rows: [], sprintId: null });
});

describe("GET /api/v1/tasks — wire contract", () => {
  const call = (qs = "") => tasksGET(new NextRequest(`https://crm.test/api/v1/tasks${qs}`));

  it("limit defaults to 50 when omitted", async () => {
    await call();
    expect(mocks.listTasks).toHaveBeenCalledWith(
      WORKSPACE_ID,
      "usr_1",
      expect.objectContaining({ limit: 50 }),
    );
  });

  it("limit caps at 200", async () => {
    await call("?limit=5000");
    expect(mocks.listTasks).toHaveBeenCalledWith(
      WORKSPACE_ID,
      "usr_1",
      expect.objectContaining({ limit: 200 }),
    );
  });

  it("a non-numeric limit falls back to 50, not NaN (which would 500 in Postgres)", async () => {
    await call("?limit=abc");
    expect(mocks.listTasks).toHaveBeenCalledWith(
      WORKSPACE_ID,
      "usr_1",
      expect.objectContaining({ limit: 50 }),
    );
  });

  it("showCompleted defaults to false", async () => {
    await call();
    expect(mocks.listTasks).toHaveBeenCalledWith(
      WORKSPACE_ID,
      "usr_1",
      expect.objectContaining({ showCompleted: false }),
    );
  });

  it("includeSubtasks defaults to false", async () => {
    await call();
    expect(mocks.listTasks).toHaveBeenCalledWith(
      WORKSPACE_ID,
      "usr_1",
      expect.objectContaining({ includeSubtasks: false }),
    );
  });

  it("sprintId=none sets noSprint and never calls getActiveSprint", async () => {
    await call("?sprintId=none");
    expect(mocks.getActiveSprint).not.toHaveBeenCalled();
    expect(mocks.listTasks).toHaveBeenCalledWith(
      WORKSPACE_ID,
      "usr_1",
      expect.objectContaining({ noSprint: true }),
    );
  });

  it("sprintId=active with no running sprint short-circuits to an empty page WITHOUT calling listTasks", async () => {
    mocks.getActiveSprint.mockResolvedValue(null);
    const res = await call("?sprintId=active");
    const body = await res.json();

    expect(mocks.listTasks).not.toHaveBeenCalled();
    expect(body.data).toEqual({ tasks: [], pagination: { limit: 50, offset: 0, total: 0 } });
  });

  it("sprintId=active with a running sprint resolves to that sprint's id", async () => {
    mocks.getActiveSprint.mockResolvedValue({ id: "spr_active_1" });
    await call("?sprintId=active");
    expect(mocks.listTasks).toHaveBeenCalledWith(
      WORKSPACE_ID,
      "usr_1",
      expect.objectContaining({ sprintId: "spr_active_1" }),
    );
  });

  it("an explicit sprintId is passed through verbatim, no getActiveSprint lookup", async () => {
    await call("?sprintId=spr_explicit_9");
    expect(mocks.getActiveSprint).not.toHaveBeenCalled();
    expect(mocks.listTasks).toHaveBeenCalledWith(
      WORKSPACE_ID,
      "usr_1",
      expect.objectContaining({ sprintId: "spr_explicit_9" }),
    );
  });

  it("response envelope is exactly {tasks, pagination}", async () => {
    mocks.listTasks.mockResolvedValue({ tasks: [{ id: "t1" }], total: 1 });
    const res = await call();
    const body = await res.json();
    expect(Object.keys(body.data).sort()).toEqual(["pagination", "tasks"]);
  });
});

describe("GET /api/v1/projects — wire contract", () => {
  const call = (qs = "") => projectsGET(new NextRequest(`https://crm.test/api/v1/projects${qs}`));

  it("limit defaults to 50 when omitted", async () => {
    await call();
    expect(mocks.listProjects).toHaveBeenCalledWith(
      WORKSPACE_ID,
      "usr_1",
      expect.objectContaining({ limit: 50 }),
    );
  });

  it("limit caps at 200", async () => {
    await call("?limit=5000");
    expect(mocks.listProjects).toHaveBeenCalledWith(
      WORKSPACE_ID,
      "usr_1",
      expect.objectContaining({ limit: 200 }),
    );
  });

  it("limit=0 is preserved verbatim (count-only), not clamped up to 1 like /tasks", async () => {
    await call("?limit=0");
    expect(mocks.listProjects).toHaveBeenCalledWith(
      WORKSPACE_ID,
      "usr_1",
      expect.objectContaining({ limit: 0 }),
    );
  });

  it("the favorites filter param is favoritesOnly, defaulting to false", async () => {
    await call();
    expect(mocks.listProjects).toHaveBeenCalledWith(
      WORKSPACE_ID,
      "usr_1",
      expect.objectContaining({ favoritesOnly: false }),
    );

    await call("?favoritesOnly=true");
    expect(mocks.listProjects).toHaveBeenCalledWith(
      WORKSPACE_ID,
      "usr_1",
      expect.objectContaining({ favoritesOnly: true }),
    );
  });

  it("response envelope is exactly {projects, pagination}", async () => {
    mocks.listProjects.mockResolvedValue({ projects: [{ id: "p1" }], total: 1 });
    const res = await call();
    const body = await res.json();
    expect(Object.keys(body.data).sort()).toEqual(["pagination", "projects"]);
  });
});

describe("GET /api/v1/projects/[projectId] — bare project object", () => {
  it("the project IS data, not { project: {...} } or a nested envelope", async () => {
    mocks.getProject.mockResolvedValue({ id: "proj_1", name: "Umzug Müller", stats: { totalTasks: 0 } });
    const res = await projectDetailGET(
      new NextRequest("https://crm.test/api/v1/projects/proj_1"),
      { params: Promise.resolve({ projectId: "proj_1" }) },
    );
    const body = await res.json();

    expect(body.data.id).toBe("proj_1");
    expect(body.data.name).toBe("Umzug Müller");
    // Bare object: no extra "project" wrapper key alongside the real fields.
    expect(body.data.project).toBeUndefined();
  });
});

describe("GET /api/v1/work/timeline — wire contract", () => {
  const call = (qs = "") =>
    timelineGET(new NextRequest(`https://crm.test/api/v1/work/timeline${qs}`));

  it("omitting maxBarsPerRow defers to the service default (12, DEFAULT_MAX_BARS_PER_ROW in work-dashboard.ts) instead of the route inventing its own", async () => {
    await call();
    expect(mocks.getSprintTimeline).toHaveBeenCalledWith(
      WORKSPACE_ID,
      expect.objectContaining({ maxBarsPerRow: undefined }),
    );
  });

  it("maxBarsPerRow caps at 100", async () => {
    await call("?maxBarsPerRow=9000");
    expect(mocks.getSprintTimeline).toHaveBeenCalledWith(
      WORKSPACE_ID,
      expect.objectContaining({ maxBarsPerRow: 100 }),
    );
  });

  it("a valid value under the cap passes through unchanged", async () => {
    await call("?maxBarsPerRow=40");
    expect(mocks.getSprintTimeline).toHaveBeenCalledWith(
      WORKSPACE_ID,
      expect.objectContaining({ maxBarsPerRow: 40 }),
    );
  });

  it("a non-positive or non-numeric value falls back to the service default, not 0/NaN", async () => {
    await call("?maxBarsPerRow=0");
    expect(mocks.getSprintTimeline).toHaveBeenCalledWith(
      WORKSPACE_ID,
      expect.objectContaining({ maxBarsPerRow: undefined }),
    );

    await call("?maxBarsPerRow=abc");
    expect(mocks.getSprintTimeline).toHaveBeenLastCalledWith(
      WORKSPACE_ID,
      expect.objectContaining({ maxBarsPerRow: undefined }),
    );
  });
});

describe("POST /api/v1/projects/plan-generate — response envelope is {plan, error}", () => {
  const call = (body: Record<string, unknown>) =>
    planGeneratePOST(
      new NextRequest("https://crm.test/api/v1/projects/plan-generate", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
  const VALID_BODY = { name: "Büroumzug", category: "vertrieb" };

  it("success: {plan, error: null}", async () => {
    mocks.generateProjectPlan.mockResolvedValue({ ok: true, plan: { phases: [] } });
    const res = await call(VALID_BODY);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Object.keys(body.data).sort()).toEqual(["error", "plan"]);
    expect(body.data.error).toBeNull();
    expect(body.data.plan).toEqual({ phases: [] });
  });

  it("service-reported failure: {plan: null, error} — still 200, spec §9: a failure must never block the wizard", async () => {
    mocks.generateProjectPlan.mockResolvedValue({ ok: false, error: "Zeitüberschreitung" });
    const res = await call(VALID_BODY);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Object.keys(body.data).sort()).toEqual(["error", "plan"]);
    expect(body.data.plan).toBeNull();
    expect(body.data.error).toBe("Zeitüberschreitung");
  });

  it("a thrown error is also folded into {plan: null, error}, not a 500", async () => {
    mocks.generateProjectPlan.mockRejectedValue(new Error("boom"));
    const res = await call(VALID_BODY);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.plan).toBeNull();
    expect(typeof body.data.error).toBe("string");
  });
});

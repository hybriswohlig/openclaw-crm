import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  listEmployees: vi.fn(),
  createEmployee: vi.fn(),
  getEmployee: vi.fn(),
  updateEmployee: vi.fn(),
  deleteEmployee: vi.fn(),
  getEmployeeContracts: vi.fn(),
  getEmployeeDetailExtras: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/services/employees", () => ({
  listEmployees: mocks.listEmployees,
  createEmployee: mocks.createEmployee,
  getEmployee: mocks.getEmployee,
  updateEmployee: mocks.updateEmployee,
  deleteEmployee: mocks.deleteEmployee,
  getEmployeeContracts: mocks.getEmployeeContracts,
  getEmployeeDetailExtras: mocks.getEmployeeDetailExtras,
}));

import { POST } from "./route";
import { PATCH } from "./[employeeId]/route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.createEmployee.mockResolvedValue({ id: "e1", hourlyRate: "20.50" });
  mocks.updateEmployee.mockResolvedValue({ id: "e1", hourlyRate: "18.50" });
});

const post = (body: unknown) =>
  new NextRequest("http://localhost/api/v1/employees", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const patch = (body: unknown) =>
  new NextRequest("http://localhost/api/v1/employees/e1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

describe("hourlyRate an den alten Mitarbeiter-Routen", () => {
  it("POST ungültig → 400, nichts angelegt", async () => {
    const res = await POST(post({ name: "Ada", hourlyRate: "x" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "BAD_REQUEST", message: "hourlyRate ungültig (1 bis 200 € je Stunde)" } });
    expect(mocks.createEmployee).not.toHaveBeenCalled();
  });

  it("POST „20,5“ geht an den Dienst", async () => {
    const res = await POST(post({ name: "Ada", hourlyRate: "20,5" }));
    expect(res.status).toBe(201);
    expect(mocks.createEmployee).toHaveBeenCalledWith("ws_1", expect.objectContaining({ hourlyRate: "20,5", name: "Ada" }));
  });

  it("POST ohne Satz bleibt bei der alten Meldung", async () => {
    const res = await POST(post({ name: "Ada" }));
    expect((await res.json()).error.message).toBe("hourlyRate is required and must be a number");
    expect(mocks.createEmployee).not.toHaveBeenCalled();
  });

  it("PATCH ungültig → 400, nichts geschrieben", async () => {
    const res = await PATCH(patch({ hourlyRate: "abc" }), { params: Promise.resolve({ employeeId: "e1" }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe("hourlyRate ungültig (1 bis 200 € je Stunde)");
    expect(mocks.updateEmployee).not.toHaveBeenCalled();
  });

  it("Review M7: 0 € und zu große Sätze → 400 an POST und PATCH", async () => {
    for (const hourlyRate of [0, "0", "200,01", 30000000]) {
      expect((await POST(post({ name: "Ada", hourlyRate }))).status).toBe(400);
      expect((await PATCH(patch({ hourlyRate }), { params: Promise.resolve({ employeeId: "e1" }) })).status).toBe(400);
    }
    expect(mocks.createEmployee).not.toHaveBeenCalled();
    expect(mocks.updateEmployee).not.toHaveBeenCalled();
    expect((await POST(post({ name: "Ada", hourlyRate: "200" }))).status).toBe(201);
  });
});

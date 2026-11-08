import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  dealImWorkspace: vi.fn(),
  listDealEmployees: vi.fn(),
  assignEmployeeToDeal: vi.fn(),
  getEmployee: vi.fn(),
  updateDealEmployeeRole: vi.fn(),
  unassignEmployeeFromDeal: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>();
  return { ...actual, getAuthContext: mocks.getAuthContext };
});
vi.mock("@/lib/kalkulation-versionen-antwort", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/kalkulation-versionen-antwort")>();
  return { ...actual, dealImWorkspace: mocks.dealImWorkspace };
});
vi.mock("@/services/employees", () => ({
  listDealEmployees: mocks.listDealEmployees,
  assignEmployeeToDeal: mocks.assignEmployeeToDeal,
  getEmployee: mocks.getEmployee,
  updateDealEmployeeRole: mocks.updateDealEmployeeRole,
  unassignEmployeeFromDeal: mocks.unassignEmployeeFromDeal,
}));

import { GET, POST } from "./route";
import { DELETE, PATCH } from "./[assignmentId]/route";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const, authMethod: "cookie" as const };
const p = { params: Promise.resolve({ recordId: "deal_1" }) };
const pZu = { params: Promise.resolve({ recordId: "deal_1", assignmentId: "asg_1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.dealImWorkspace.mockResolvedValue(true);
  mocks.listDealEmployees.mockResolvedValue([]);
  mocks.getEmployee.mockResolvedValue({ id: "e1", name: "Ada" });
  mocks.assignEmployeeToDeal.mockResolvedValue({ id: "asg_1" });
  mocks.updateDealEmployeeRole.mockResolvedValue({ id: "asg_1", role: "lead" });
  mocks.unassignEmployeeFromDeal.mockResolvedValue({ id: "asg_1" });
});

const post = (body: unknown) =>
  new NextRequest("http://localhost/api/v1/deals/deal_1/employees", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

describe("alte Zuweisungs-Routen", () => {
  it("Deal außerhalb des Workspace → 404, nichts gelesen oder geschrieben", async () => {
    mocks.dealImWorkspace.mockResolvedValue(false);
    const get = new NextRequest("http://localhost/api/v1/deals/deal_1/employees");
    expect((await GET(get, p)).status).toBe(404);
    expect((await POST(post({ employeeId: "e1" }), p)).status).toBe(404);
    const patch = new NextRequest("http://localhost/api/v1/deals/deal_1/employees/asg_1", {
      method: "PATCH",
      body: JSON.stringify({ role: "lead" }),
      headers: { "content-type": "application/json" },
    });
    const del = new NextRequest("http://localhost/api/v1/deals/deal_1/employees/asg_1", { method: "DELETE" });
    expect((await PATCH(patch, pZu)).status).toBe(404);
    expect((await DELETE(del, pZu)).status).toBe(404);
    expect(mocks.dealImWorkspace).toHaveBeenCalledWith("ws_1", "deal_1");
    expect(mocks.listDealEmployees).not.toHaveBeenCalled();
    expect(mocks.assignEmployeeToDeal).not.toHaveBeenCalled();
    expect(mocks.updateDealEmployeeRole).not.toHaveBeenCalled();
    expect(mocks.unassignEmployeeFromDeal).not.toHaveBeenCalled();
  });

  it("POST: Mitarbeiter muss im Workspace sein", async () => {
    mocks.getEmployee.mockResolvedValue(null);
    const res = await POST(post({ employeeId: "fremd" }), p);
    expect(res.status).toBe(404);
    expect(mocks.getEmployee).toHaveBeenCalledWith("ws_1", "fremd");
    expect(mocks.assignEmployeeToDeal).not.toHaveBeenCalled();
  });

  it("POST legt zu, PATCH und DELETE filtern über den Deal", async () => {
    expect((await POST(post({ employeeId: "e1", role: "lead" }), p)).status).toBe(201);
    expect(mocks.assignEmployeeToDeal).toHaveBeenCalledWith("deal_1", "e1", "lead");

    const patch = () =>
      new NextRequest("http://localhost/api/v1/deals/deal_1/employees/asg_1", {
        method: "PATCH",
        body: JSON.stringify({ role: "lead" }),
        headers: { "content-type": "application/json" },
      });
    expect((await PATCH(patch(), pZu)).status).toBe(200);
    expect(mocks.updateDealEmployeeRole).toHaveBeenCalledWith("deal_1", "asg_1", "lead");

    mocks.updateDealEmployeeRole.mockResolvedValue(null);
    expect((await PATCH(patch(), pZu)).status).toBe(404);

    const del = () => new NextRequest("http://localhost/api/v1/deals/deal_1/employees/asg_1", { method: "DELETE" });
    expect((await DELETE(del(), pZu)).status).toBe(200);
    expect(mocks.unassignEmployeeFromDeal).toHaveBeenCalledWith("asg_1", "deal_1");
    mocks.unassignEmployeeFromDeal.mockResolvedValue(null);
    expect((await DELETE(del(), pZu)).status).toBe(404);
  });
});

import { describe, expect, it } from "vitest";
import { GET as getAttachment } from "./route";
import { GET as getContent } from "./content/route";

describe("invented deal-attachment paths", () => {
  it("GET /api/v1/deals/{recordId}/attachments/{id} returns JSON Not found", async () => {
    const res = await getAttachment();
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "Not found" });
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("GET /api/v1/deals/{recordId}/attachments/{id}/content returns JSON Not found", async () => {
    const res = await getContent();
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "Not found" });
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

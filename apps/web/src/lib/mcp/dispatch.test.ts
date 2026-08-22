import { describe, it, expect, vi } from "vitest";
import { handleTool, type ToolContent } from "./dispatch";
import type { CrmClient } from "./client";
import { MAX_MCP_INLINE_BYTES_LIMIT } from "@/lib/attachment-content";
import type { AttachmentPayload } from "@/lib/attachment-content";

/**
 * Minimal CrmClient stand-in that records what dispatch forwarded.
 *
 * `response` is optional so the pre-existing call-shape tests keep the plain
 * `{ ok: true }` stub; tools that post-process the payload (crm_get_attachment)
 * pass the body they need to exercise.
 */
function fakeClient(response: unknown = { ok: true }) {
  const calls: Array<{ path: string; options: Record<string, unknown> }> = [];
  const client = {
    request: vi.fn(async (path: string, options: Record<string, unknown> = {}) => {
      calls.push({ path, options });
      return response;
    }),
    context: {
      baseUrl: "https://crm.example.test",
      userId: "u1",
      workspaceId: "w1",
      workspaceRole: "admin" as const,
    },
  };
  return { client: client as unknown as CrmClient, calls };
}

/**
 * Narrow a result to its text block.
 *
 * `handleTool` returns a text|image union now, so nothing may index `.text`
 * off `content[0]` — tsconfig includes the tests, and `next build` fails on it.
 */
function textOf(content: ToolContent[]): string {
  const block = content.find((c) => c.type === "text");
  if (!block || block.type !== "text") throw new Error("no text block in result");
  return block.text;
}

function textBlock(content: ToolContent[]): Record<string, unknown> {
  return JSON.parse(textOf(content)) as Record<string, unknown>;
}

function imageBlock(
  content: ToolContent[]
): { type: "image"; data: string; mimeType: string } | undefined {
  const block = content.find((c) => c.type === "image");
  return block && block.type === "image" ? block : undefined;
}

describe("crm_api body coercion", () => {
  it("parses a body that arrived as a JSON string", async () => {
    // z.unknown() serializes to an empty JSON Schema, so MCP clients have
    // nothing to validate against and send the body as a JSON string. Passing
    // it through verbatim made req.json() yield a string, so every field read
    // off it was undefined ("skill is required" on a well-formed call).
    const { client, calls } = fakeClient();

    await handleTool(client, "crm_api", {
      path: "/api/tools/run",
      method: "POST",
      body: '{"skill":"echo-test","params":{"a":1}}',
    });

    expect(calls[0].options.body).toEqual({
      skill: "echo-test",
      params: { a: 1 },
    });
  });

  it("passes an object body through untouched", async () => {
    const { client, calls } = fakeClient();

    await handleTool(client, "crm_api", {
      path: "/api/tools/run",
      method: "POST",
      body: { skill: "echo-test" },
    });

    expect(calls[0].options.body).toEqual({ skill: "echo-test" });
  });

  it("leaves a genuine string body alone", async () => {
    const { client, calls } = fakeClient();

    await handleTool(client, "crm_api", {
      path: "/api/v1/thing",
      method: "POST",
      body: "plain text, not JSON",
    });

    expect(calls[0].options.body).toBe("plain text, not JSON");
  });

  it("leaves malformed JSON alone rather than throwing", async () => {
    const { client, calls } = fakeClient();

    await handleTool(client, "crm_api", {
      path: "/api/v1/thing",
      method: "POST",
      body: '{"unterminated": ',
    });

    expect(calls[0].options.body).toBe('{"unterminated": ');
  });

  it("rejects paths outside /api/", async () => {
    const { client } = fakeClient();

    const res = await handleTool(client, "crm_api", { path: "/etc/passwd" });

    expect(res.isError).toBe(true);
    expect(textOf(res.content)).toContain("path must start with /api/");
  });
});

describe("crm_generate_document", () => {
  it("accepts stringified params and injects the deal id", async () => {
    const { client, calls } = fakeClient();

    await handleTool(client, "crm_generate_document", {
      recordId: "deal-1",
      params: '{"firma":"kottke","document_type":"AB"}',
    });

    expect(calls[0].path).toBe("/api/tools/run");
    expect(calls[0].options.body).toEqual({
      skill: "rechnungen-und-auftragsbestaetigungen",
      params: {
        firma: "kottke",
        document_type: "AB",
        _deal_record_id: "deal-1",
      },
    });
  });
});

/**
 * Base64 of a payload that really starts with the JPEG magic number.
 *
 * Built from bytes rather than a hand-written literal so a test can decode it
 * again and prove the bytes survived the round trip — the production failure
 * was an attachment that arrived as the Next.js HTML shell, which is still
 * perfectly valid base64 and would pass any string-only assertion.
 */
function jpegBase64(padding = 0): string {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(padding, 0x2a),
  ]).toString("base64");
}

/** Base64 of `bytes` bytes of non-image filler (PDF/video stand-in). */
function fillerBase64(bytes: number): string {
  return Buffer.alloc(bytes, 0x2a).toString("base64");
}

function attachmentPayload(over: Partial<AttachmentPayload> = {}): AttachmentPayload {
  return {
    id: "att-1",
    fileName: "kueche.jpg",
    mimeType: "image/jpeg",
    fileSize: 4,
    contentBase64: jpegBase64(),
    isImage: true,
    conversationId: "conv-1",
    messageId: "msg-1",
    dealRecordId: null,
    createdAt: "2026-08-01T10:00:00.000Z",
    ...over,
  };
}

describe("crm_get_attachment", () => {
  it("reads the inbox attachment route, not a deals subpath", async () => {
    // The bug: agents reached for /api/v1/deals/{id}/attachments/{id}/content,
    // which has no route handler, so Next.js answered with the HTML app shell.
    const { client, calls } = fakeClient(attachmentPayload());

    await handleTool(client, "crm_get_attachment", { id: "att/1" });

    expect(calls[0].path).toBe("/api/v1/inbox/attachments/att%2F1");
    expect(calls[0].path).not.toContain("/deals/");
    expect(
      (calls[0].options.query as Record<string, unknown>).dealRecordId
    ).toBeUndefined();
  });

  it("forwards recordId as the dealRecordId query param", async () => {
    const { client, calls } = fakeClient(attachmentPayload());

    await handleTool(client, "crm_get_attachment", {
      id: "att-1",
      recordId: "deal-9",
    });

    expect(calls[0].path).toBe("/api/v1/inbox/attachments/att-1");
    expect((calls[0].options.query as Record<string, unknown>).dealRecordId).toBe(
      "deal-9"
    );
  });

  it("returns real JPEG bytes in an image block plus metadata as text", async () => {
    const base64 = jpegBase64(8);
    const { client } = fakeClient(
      attachmentPayload({ contentBase64: base64, fileSize: 12 })
    );

    const res = await handleTool(client, "crm_get_attachment", { id: "att-1" });

    const image = imageBlock(res.content);
    expect(image).toBeDefined();
    expect(image!.mimeType).toBe("image/jpeg");
    expect(image!.data).toBe(base64);

    // The whole point of the fix: what the client renders has to decode to a
    // JPEG. Before this, res.text() on the binary body handed over UTF-8
    // replacement characters (or an HTML shell) under an image mime type.
    const decoded = Buffer.from(image!.data, "base64");
    expect([...decoded.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);

    // ImageContentSchema.data is z.string().base64() in the MCP SDK, so a
    // "data:image/jpeg;base64," prefix is rejected client-side before the
    // block ever reaches the model. Bare base64 only.
    expect(image!.data).not.toMatch(/^data:/);
    expect(image!.data).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);

    const meta = textBlock(res.content);
    expect(meta.contentDelivery).toBe("image_block");
    expect(meta.id).toBe("att-1");
    expect(meta.fileName).toBe("kueche.jpg");
    expect(meta.mimeType).toBe("image/jpeg");
    expect(meta.isImage).toBe(true);
    expect(meta.conversationId).toBe("conv-1");
  });

  it("format:'base64' returns the bytes as text and no image block", async () => {
    const base64 = jpegBase64(8);
    const { client } = fakeClient(attachmentPayload({ contentBase64: base64 }));

    const res = await handleTool(client, "crm_get_attachment", {
      id: "att-1",
      format: "base64",
    });

    expect(imageBlock(res.content)).toBeUndefined();
    expect(textBlock(res.content).contentBase64).toBe(base64);
  });

  it("format:'both' returns the image block and the base64", async () => {
    const base64 = jpegBase64(8);
    const { client } = fakeClient(attachmentPayload({ contentBase64: base64 }));

    const res = await handleTool(client, "crm_get_attachment", {
      id: "att-1",
      format: "both",
    });

    expect(imageBlock(res.content)?.data).toBe(base64);
    const meta = textBlock(res.content);
    expect(meta.contentDelivery).toBe("image_block+base64");
    expect(meta.contentBase64).toBe(base64);
    // The contradiction: this hint used to tell the caller to re-call with
    // format: 'base64' to get bytes that were already in the same result.
    expect(String(meta.hint)).not.toContain("format: 'base64'");
    expect(String(meta.hint)).toContain("contentBase64");
  });

  it("never builds an image block for a non-renderable mime under budget", async () => {
    // A PDF in an image content block errors the whole tool call client-side,
    // so it has to degrade to base64 and say why instead of silently omitting.
    // Guards the ~95 real PDFs in the inbox against the byte budget: they are
    // small, so tightening the budget must not stop returning their bytes.
    const base64 = fillerBase64(64);
    const { client } = fakeClient(
      attachmentPayload({
        mimeType: "application/pdf",
        fileName: "angebot.pdf",
        contentBase64: base64,
        isImage: false,
      })
    );

    const res = await handleTool(client, "crm_get_attachment", { id: "att-1" });

    expect(imageBlock(res.content)).toBeUndefined();
    const meta = textBlock(res.content);
    expect(meta.contentDelivery).toBe("base64");
    expect(meta.contentBase64).toBe(base64);
    expect(meta.isImage).toBe(false);
    expect(String(meta.hint)).toContain("application/pdf");
    expect(String(meta.hint)).toContain("not a renderable image type");
  });

  it("renders image/jpg, the bogus mime WhatsApp sends, as image/jpeg", async () => {
    const base64 = jpegBase64(8);
    const { client } = fakeClient(
      attachmentPayload({ mimeType: "image/jpg", contentBase64: base64 })
    );

    const res = await handleTool(client, "crm_get_attachment", { id: "att-1" });

    const image = imageBlock(res.content);
    expect(image).toBeDefined();
    expect(image!.mimeType).toBe("image/jpeg");
    // The metadata keeps what the sender claimed; only the block is normalised.
    expect(textBlock(res.content).mimeType).toBe("image/jpg");
  });

  it("omits the bytes over the byte budget instead of erroring", async () => {
    // maxBytes caps the whole result, not just the image block: falling back
    // to base64 here would have inlined the payload anyway and defeated it.
    const base64 = jpegBase64(60);
    const { client } = fakeClient(attachmentPayload({ contentBase64: base64 }));

    const res = await handleTool(client, "crm_get_attachment", {
      id: "att-1",
      maxBytes: 8,
    });

    expect(res.isError).toBeFalsy();
    expect(imageBlock(res.content)).toBeUndefined();
    const meta = textBlock(res.content);
    expect(meta.contentDelivery).toBe("omitted_too_large");
    expect(meta.contentBase64).toBeUndefined();
    expect(String(meta.hint)).toContain("8-byte");
    expect(String(meta.hint)).toContain("maxBytes");
    expect(String(meta.hint)).toContain(String(MAX_MCP_INLINE_BYTES_LIMIT));
    // The bytes stay reachable, so the hint has to name the uncapped route.
    expect(String(meta.hint)).toContain("/api/v1/inbox/attachments/att-1");
  });

  it("returns no bytes at all for a non-renderable file over budget", async () => {
    // The case that motivated the budget: the largest production attachment is
    // a 9.1 MB video/mp4, which as base64 would be ~12 MB in one JSON-RPC
    // result. Non-renderable must not mean "exempt from the budget".
    const { client } = fakeClient(
      attachmentPayload({
        mimeType: "video/mp4",
        fileName: "wohnung.mp4",
        contentBase64: fillerBase64(64),
        isImage: false,
      })
    );

    const res = await handleTool(client, "crm_get_attachment", {
      id: "att-1",
      maxBytes: 8,
    });

    expect(res.isError).toBeFalsy();
    expect(imageBlock(res.content)).toBeUndefined();
    const meta = textBlock(res.content);
    expect(meta.contentDelivery).toBe("omitted_too_large");
    expect(meta.contentBase64).toBeUndefined();
    expect(String(meta.hint)).toContain("maxBytes");
    expect(String(meta.hint)).toContain("/api/v1/inbox/attachments/att-1");
  });

  it("stops offering a higher maxBytes past the hard ceiling", async () => {
    // The circular-advice branch: past MAX_MCP_INLINE_BYTES_LIMIT no maxBytes
    // can inline the payload, so repeating "raise maxBytes" would loop the
    // caller. Synthetic filler rather than real bytes — base64ByteLength only
    // reads .length, and allocating 24 MB of image data per run buys nothing.
    const overCeiling = "A".repeat(
      Math.ceil((MAX_MCP_INLINE_BYTES_LIMIT + 1024) / 3) * 4
    );
    const { client } = fakeClient(
      attachmentPayload({
        mimeType: "video/mp4",
        fileName: "besichtigung.mp4",
        contentBase64: overCeiling,
        isImage: false,
      })
    );

    const res = await handleTool(client, "crm_get_attachment", { id: "att-1" });

    expect(res.isError).toBeFalsy();
    expect(imageBlock(res.content)).toBeUndefined();
    const meta = textBlock(res.content);
    expect(meta.contentDelivery).toBe("omitted_too_large");
    expect(meta.contentBase64).toBeUndefined();

    const hint = String(meta.hint);
    expect(hint).not.toContain("Re-call with maxBytes above");
    expect(hint).toContain("hard ceiling");
    expect(hint).toContain(String(MAX_MCP_INLINE_BYTES_LIMIT));
    expect(hint).toContain("/api/v1/inbox/attachments/att-1");

    // Under the ceiling that advice is still the fastest way out, so the two
    // branches must not collapse into one message.
    const under = fakeClient(attachmentPayload({ contentBase64: jpegBase64(60) }));
    const underRes = await handleTool(under.client, "crm_get_attachment", {
      id: "att-1",
      maxBytes: 8,
    });
    const underHint = String(textBlock(underRes.content).hint);
    expect(underHint).toContain("Re-call with maxBytes above");
    expect(underHint).not.toBe(hint);
  });

  it("never emits an empty image block for an attachment stored with no bytes", async () => {
    // A zero-byte fileContent yielded { type: "image", data: "" }, which most
    // vision clients reject for the ENTIRE tool call — one broken row took out
    // the whole result rather than just itself.
    const { client } = fakeClient(
      attachmentPayload({ contentBase64: "", fileSize: 0 })
    );

    const res = await handleTool(client, "crm_get_attachment", { id: "att-1" });

    expect(res.isError).toBeFalsy();
    expect(imageBlock(res.content)).toBeUndefined();
    const meta = textBlock(res.content);
    expect(meta.contentDelivery).toBe("base64");
    expect(meta.byteLength).toBe(0);
    expect(meta.contentBase64).toBe("");
    expect(String(meta.hint)).toContain("empty content");
    expect(String(meta.hint)).toContain("missing");
  });

  it("does not duplicate the base64 into the text block by default", async () => {
    // Inlining it next to the image block doubles the token cost of every
    // photo for zero gain, so the default result must carry the bytes once.
    const { client } = fakeClient(
      attachmentPayload({ contentBase64: jpegBase64(8) })
    );

    const res = await handleTool(client, "crm_get_attachment", { id: "att-1" });

    expect(textBlock(res.content)).not.toHaveProperty("contentBase64");
  });
});

describe("removed tools", () => {
  it("no longer dispatches crm_tasks_pulse", async () => {
    // /api/v1/tasks/pulse is deleted with the Team-Pulse bar in phase 4. A
    // tool that outlives its route answers 404-as-HTML, which is worse than
    // an honest "Unknown tool".
    const { client, calls } = fakeClient();

    const res = await handleTool(client, "crm_tasks_pulse", {});

    expect(res.isError).toBe(true);
    expect(textOf(res.content)).toContain("Unknown tool: crm_tasks_pulse");
    expect(calls).toHaveLength(0);
  });
});

describe("crm_list_projects", () => {
  it("coerces the filter booleans and numbers into the query string", async () => {
    // MCP clients send booleans and numbers as strings often enough that a
    // raw pass-through means ?favoritesOnly=true reaches the route as the
    // string "true" — which its `=== true` check silently drops.
    const { client, calls } = fakeClient();

    await handleTool(client, "crm_list_projects", {
      status: "aktiv",
      category: "fuhrpark",
      favoritesOnly: "true",
      includeArchived: "false",
      limit: "25",
      offset: "50",
    });

    expect(calls[0].path).toBe("/api/v1/projects");
    expect(calls[0].options.query).toEqual({
      status: "aktiv",
      category: "fuhrpark",
      sprintId: undefined,
      favoritesOnly: true,
      includeArchived: false,
      limit: 25,
      offset: 50,
    });
  });
});

describe("crm_create_project", () => {
  it("posts the project body, coercing cents and stringified scope arrays", async () => {
    const { client, calls } = fakeClient();

    await handleTool(client, "crm_create_project", {
      name: "Fuhrpark 2027",
      category: "fuhrpark",
      priority: "hoch",
      startDate: "2026-09-01",
      budgetPlannedCents: "1250000",
      scopeIn: '["Zwei 7,5-Tonner","Telematik"]',
      scopeOut: ["Anhaenger"],
    });

    expect(calls[0].path).toBe("/api/v1/projects");
    expect(calls[0].options.method).toBe("POST");
    expect(calls[0].options.body).toEqual({
      name: "Fuhrpark 2027",
      category: "fuhrpark",
      priority: "hoch",
      startDate: "2026-09-01",
      budgetPlannedCents: 1250000,
      scopeIn: ["Zwei 7,5-Tonner", "Telematik"],
      scopeOut: ["Anhaenger"],
    });
  });

  it("sends only the fields the caller passed", async () => {
    // The route is a real PATCH/POST pair, not a PUT: a body full of
    // explicit undefineds would blank half the project on the way in.
    const { client, calls } = fakeClient();

    await handleTool(client, "crm_create_project", { name: "Nur Name" });

    expect(calls[0].options.body).toEqual({ name: "Nur Name" });
  });

  it("maps memberUserIds to the members array the route actually reads", async () => {
    // POST /api/v1/projects's parseProjectInput whitelists exactly
    // members/phases/milestones/risks/budgetEntries as its nested keys and
    // silently drops anything else — a raw `memberUserIds` key would 201
    // with none of the requested members attached. Dispatch must translate.
    const { client, calls } = fakeClient();

    await handleTool(client, "crm_create_project", {
      name: "Fuhrpark 2027",
      memberUserIds: ["u-1", "u-2"],
    });

    expect(calls[0].options.body).toEqual({
      name: "Fuhrpark 2027",
      members: [{ userId: "u-1" }, { userId: "u-2" }],
    });
  });
});

describe("crm_update_project", () => {
  it("clears a nullable field when null is passed explicitly", async () => {
    const { client, calls } = fakeClient();

    await handleTool(client, "crm_update_project", {
      projectId: "p-1",
      budgetPlannedCents: null,
      shortDescription: null,
    });

    expect(calls[0].path).toBe("/api/v1/projects/p-1");
    expect(calls[0].options.method).toBe("PATCH");
    expect(calls[0].options.body).toEqual({
      shortDescription: null,
      budgetPlannedCents: null,
    });
  });
});

describe("crm_set_project_favorite", () => {
  it("PUTs to pin and DELETEs to unpin", async () => {
    const pin = fakeClient();
    await handleTool(pin.client, "crm_set_project_favorite", {
      projectId: "p-1",
      favorite: true,
    });
    expect(pin.calls[0].path).toBe("/api/v1/projects/p-1/favorite");
    expect(pin.calls[0].options.method).toBe("PUT");

    const unpin = fakeClient();
    await handleTool(unpin.client, "crm_set_project_favorite", {
      projectId: "p-1",
      favorite: "false",
    });
    expect(unpin.calls[0].options.method).toBe("DELETE");
  });
});

describe("crm_reorder_project_phases", () => {
  it("parses an orderedPhaseIds array that arrived as a JSON string", async () => {
    // z.array(z.string()) serialises fine, but clients that build the call
    // from a text template still send "[\"a\",\"b\"]". Forwarding that
    // verbatim gives the route a string where it expects an array.
    const { client, calls } = fakeClient();

    await handleTool(client, "crm_reorder_project_phases", {
      projectId: "p-1",
      orderedPhaseIds: '["ph-3","ph-1","ph-2"]',
    });

    expect(calls[0].path).toBe("/api/v1/projects/p-1/phases/reorder");
    expect(calls[0].options.method).toBe("POST");
    expect(calls[0].options.body).toEqual({
      orderedPhaseIds: ["ph-3", "ph-1", "ph-2"],
    });
  });
});

describe("crm_create_project_phase", () => {
  it("posts to the project's phases collection with only the passed fields", async () => {
    const { client, calls } = fakeClient();

    await handleTool(client, "crm_create_project_phase", {
      projectId: "p-1",
      name: "Ausschreibung",
      dueDate: "2026-10-15",
    });

    expect(calls[0].path).toBe("/api/v1/projects/p-1/phases");
    expect(calls[0].options.method).toBe("POST");
    expect(calls[0].options.body).toEqual({
      name: "Ausschreibung",
      dueDate: "2026-10-15",
    });
  });
});

describe("crm_update_project_milestone", () => {
  it("PATCHes the nested milestone path and clears phaseId with null", async () => {
    const { client, calls } = fakeClient();

    await handleTool(client, "crm_update_project_milestone", {
      projectId: "p-1",
      milestoneId: "ms 7",
      status: "erreicht",
      phaseId: null,
    });

    expect(calls[0].path).toBe("/api/v1/projects/p-1/milestones/ms%207");
    expect(calls[0].options.method).toBe("PATCH");
    expect(calls[0].options.body).toEqual({
      status: "erreicht",
      phaseId: null,
    });
  });
});

describe("crm_add_project_member", () => {
  it("posts userId and role to the project's members collection", async () => {
    const { client, calls } = fakeClient();

    await handleTool(client, "crm_add_project_member", {
      projectId: "p-1",
      userId: "u-9",
      role: "leiter",
    });

    expect(calls[0].path).toBe("/api/v1/projects/p-1/members");
    expect(calls[0].options.method).toBe("POST");
    expect(calls[0].options.body).toEqual({ userId: "u-9", role: "leiter" });
  });
});

describe("crm_remove_project_member", () => {
  it("DELETEs the member subresource, url-encoding the user id", async () => {
    const { client, calls } = fakeClient();

    await handleTool(client, "crm_remove_project_member", {
      projectId: "p-1",
      userId: "u/9",
    });

    expect(calls[0].path).toBe("/api/v1/projects/p-1/members/u%2F9");
    expect(calls[0].options.method).toBe("DELETE");
  });
});

describe("crm_create_project_risk", () => {
  it("posts the risk body without inventing defaults", async () => {
    // severity/likelihood defaults belong to the service, not to dispatch —
    // a default sent from here would override whatever the service decides.
    const { client, calls } = fakeClient();

    await handleTool(client, "crm_create_project_risk", {
      projectId: "p-1",
      title: "Lieferzeit der Transporter",
      severity: "hoch",
      mitigation: "Zweiten Haendler anfragen",
    });

    expect(calls[0].path).toBe("/api/v1/projects/p-1/risks");
    expect(calls[0].options.method).toBe("POST");
    expect(calls[0].options.body).toEqual({
      title: "Lieferzeit der Transporter",
      severity: "hoch",
      mitigation: "Zweiten Haendler anfragen",
    });
  });
});

describe("crm_create_project_budget_entry", () => {
  it("coerces amountCents from a string so cents never reach the route as text", async () => {
    // The whole money model is integer cents. A string amount would be
    // stored as NaN or rejected, and the budget bar would silently stall.
    const { client, calls } = fakeClient();

    await handleTool(client, "crm_create_project_budget_entry", {
      projectId: "p-1",
      label: "Leasingrate Mai",
      amountCents: "89900",
      kind: "ist",
      bookedAt: "2026-05-02",
    });

    expect(calls[0].path).toBe("/api/v1/projects/p-1/budget");
    expect(calls[0].options.method).toBe("POST");
    expect(calls[0].options.body).toEqual({
      label: "Leasingrate Mai",
      amountCents: 89900,
      kind: "ist",
      bookedAt: "2026-05-02",
    });
  });
});

describe("crm_get_project_document", () => {
  it("reads the project document subresource, not a deals path", async () => {
    // Project documents live under /projects, deal PDFs under /deals. The
    // wrong prefix answers with the Next.js HTML shell, not a 404.
    const { client, calls } = fakeClient();

    await handleTool(client, "crm_get_project_document", {
      projectId: "p-1",
      documentId: "doc-2",
    });

    expect(calls[0].path).toBe("/api/v1/projects/p-1/documents/doc-2");
    expect(calls[0].path).not.toContain("/deals/");
    expect(calls[0].options.method).toBeUndefined();
  });
});

describe("crm_add_task_dependency", () => {
  it("puts the successor in the path and the predecessor in the body", async () => {
    // The edge reads "predecessor must finish before successor can start".
    // Swapping the two silently inverts every arrow on the sprint timeline,
    // so the direction is pinned by a test rather than by a comment.
    const { client, calls } = fakeClient();

    await handleTool(client, "crm_add_task_dependency", {
      predecessorTaskId: "t-vorher",
      successorTaskId: "t-danach",
    });

    expect(calls[0].path).toBe("/api/v1/tasks/t-danach/dependencies");
    expect(calls[0].options.method).toBe("POST");
    expect(calls[0].options.body).toEqual({ predecessorTaskId: "t-vorher" });
  });

  it("url-encodes both ids", async () => {
    const { client, calls } = fakeClient();

    await handleTool(client, "crm_add_task_dependency", {
      predecessorTaskId: "a/b",
      successorTaskId: "c/d",
    });

    expect(calls[0].path).toBe("/api/v1/tasks/c%2Fd/dependencies");
    expect(calls[0].options.body).toEqual({ predecessorTaskId: "a/b" });
  });
});

describe("crm_remove_task_dependency", () => {
  it("DELETEs the edge under the task it is listed on", async () => {
    const { client, calls } = fakeClient();

    await handleTool(client, "crm_remove_task_dependency", {
      taskId: "t-1",
      dependencyId: "dep-5",
    });

    expect(calls[0].path).toBe("/api/v1/tasks/t-1/dependencies/dep-5");
    expect(calls[0].options.method).toBe("DELETE");
  });
});

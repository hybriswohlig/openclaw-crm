import { describe, expect, it } from "vitest";

import { kvEditorBeimNeuenKv, kvEditorStandZumNeuenKv } from "./kv-editor-haken";

describe("KV-Editor-Haken (Stub aus 0b)", () => {
  it("ohne Quelle bleibt ein neuer KV wie heute", async () => {
    await expect(kvEditorBeimNeuenKv("ws", "deal")).resolves.toEqual({ quelle: null });
  });

  it("Stand zum neuen KV ist noch nicht gebaut", async () => {
    await expect(
      kvEditorStandZumNeuenKv({} as never, "ws", "deal", {
        renderer: "crm",
        grundlage: { copy: {} },
        aenderungen: [],
        offen: [],
        quelleId: null,
        calculationVersionId: null,
        renderJobId: null,
        dealDocumentId: null,
        pruefung: null,
        userId: null,
      })
    ).rejects.toThrow("kv-editor: Haken noch nicht gebaut");
  });
});

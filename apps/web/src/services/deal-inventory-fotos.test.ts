import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ runAITask: vi.fn(), bestand: [] as unknown[], updates: [] as unknown[], neu: [] as unknown[] }));
vi.mock("@/db", () => {
  const kette = (ergebnis: unknown) => {
    const k: Record<string, unknown> = {};
    for (const m of ["from", "where", "orderBy"]) k[m] = () => k;
    k.then = (ok: (v: unknown) => unknown) => Promise.resolve(ergebnis).then(ok);
    return k;
  };
  return {
    db: {
      select: () => kette(mock.bestand),
      update: () => ({ set: (v: unknown) => { mock.updates.push(v); return { where: async () => undefined }; } }),
      insert: () => ({ values: async (v: unknown) => { mock.neu.push(v); } }),
    },
  };
});
vi.mock("./ai/run-task", () => ({ runAITask: mock.runAITask }));
vi.mock("./activity-events", () => ({ emitEvent: vi.fn() }));
vi.mock("@/services/rechner/ausloeser", () => ({ kalkulationAnstossen: vi.fn() }));
vi.mock("./deal-transcript", () => ({}));
import { PHOTO_SYSTEM_PROMPT, PhotoInventorySchema, fotoDateinamen, fotoItemsUebernehmen, fotoZuordnen, fotosErkennen } from "./deal-inventory";

const foto = (id: string, fileName = "image.jpeg", mimeType = "image/jpeg") => ({
  id, fileName, mimeType, fileSize: 1000, fileContent: "QUJD",
});

describe("fotoDateinamen", () => {
  it("vergibt eindeutige Namen, WhatsApp schickt jedes Foto als image.jpeg", () => {
    expect(fotoDateinamen([foto("a"), foto("b"), foto("c", "IMG_1.PNG", "image/png"), foto("d", "x", "image/heic")]))
      .toEqual(["foto-1.jpeg", "foto-2.jpeg", "foto-3.png", "foto-4.heic"]);
  });
  it("unbekannter Bildtyp wird jpg", () => {
    expect(fotoDateinamen([foto("a", "scan", "image/")])).toEqual(["foto-1.jpg"]);
  });
});

describe("fotoZuordnen", () => {
  const namen = ["foto-1.jpeg", "foto-2.jpeg"];
  const ids = ["att-1", "att-2"];
  it("ein Foto im Stapel: jedes Item gehört zu diesem Foto, egal was die KI nennt", () => {
    expect(fotoZuordnen(null, ["foto-1.jpeg"], ["att-1"])).toBe("att-1");
    expect(fotoZuordnen("image.jpeg", ["foto-1.jpeg"], ["att-1"])).toBe("att-1");
  });
  it("mehrere Fotos: Name aus der Liste, mit oder ohne Nummer und Pfad des VPS", () => {
    expect(fotoZuordnen("foto-2.jpeg", namen, ids)).toBe("att-2");
    expect(fotoZuordnen("01_foto-2.jpeg", namen, ids)).toBe("att-2");
    expect(fotoZuordnen("/home/ubuntu/apps/crm-tools/jobs_output/x/_run/00_foto-1.jpeg", namen, ids)).toBe("att-1");
    expect(fotoZuordnen("Foto-2.JPEG", namen, ids)).toBe("att-2");
  });
  it("mehrere Fotos, unbekannter oder fehlender Name: kein Foto-Link", () => {
    expect(fotoZuordnen("image.jpeg", namen, ids)).toBeNull();
    expect(fotoZuordnen(null, namen, ids)).toBeNull();
  });
});

describe("PHOTO_SYSTEM_PROMPT", () => {
  it("verlangt eine knappe Antwort: lange JSON-Antworten liefen in die Zeitgrenze", () => {
    expect(PHOTO_SYSTEM_PROMPT).toContain("weglassen");
    expect(PHOTO_SYSTEM_PROMPT).not.toContain("dimensions_estimate");
    expect(PHOTO_SYSTEM_PROMPT).toContain("volume_cbm_estimate");
    expect(PHOTO_SYSTEM_PROMPT).toContain("size_class");
  });
});

describe("fotosErkennen", () => {
  beforeEach(() => mock.runAITask.mockReset());

  it("schickt eindeutige Dateinamen und verknüpft jedes Item mit seinem Foto", async () => {
    mock.runAITask.mockResolvedValue({ ok: true, output: { items: [{ name: "Ecksofa", quantity: 1, heavy: true }] } });
    const r = await fotosErkennen("ws", [foto("att-9")], { background: true });
    const aufruf = mock.runAITask.mock.calls[0][0];
    expect(aufruf.attachments.map((a: { filename: string }) => a.filename)).toEqual(["foto-1.jpeg"]);
    expect(aufruf.prompt).toContain("- foto-1.jpeg (image/jpeg)");
    expect(aufruf.background).toBe(true);
    // Eigener Format-Hinweis: der automatische sagte `"items": string`.
    expect(aufruf.schemaHint).toContain('"items":[');
    expect(aufruf.schemaHint).toContain("volume_cbm_estimate");
    expect(aufruf.schemaHint).not.toContain("dimensions_estimate");
    expect(r).toMatchObject({ ok: true, analyzed: 1, skipped: 0, analyzedIds: ["att-9"] });
    expect(r.ok && r.items[0]).toMatchObject({ name: "Ecksofa", attachmentId: "att-9" });
  });

  it("Fehler der KI kommt als Fehler zurück", async () => {
    mock.runAITask.mockResolvedValue({ ok: false, error: "crm-tools job timeout" });
    expect(await fotosErkennen("ws", [foto("att-9")], {})).toEqual({ ok: false, error: "crm-tools job timeout", skipped: 0 });
  });
});

describe("PhotoInventorySchema", () => {
  it("ein kaputtes Item leert nicht die ganze Liste", () => {
    expect(PhotoInventorySchema.parse({ items: [{ name: "" }, { name: "Sofa", quantity: 1 }, "kaputt"] }).items.map((i) => i.name)).toEqual(["Sofa"]);
  });
  it("keine Liste: leer", () => {
    expect(PhotoInventorySchema.parse({ items: "Sofa" }).items).toEqual([]);
  });
});

describe("fotoItemsUebernehmen", () => {
  const zeile = (over: Record<string, unknown>) => ({
    id: "z1", name: "Bett", quantity: 1, volumeCbmEstimate: "1.2", source: "foto", photoAttachmentId: "att-1",
    dimensionsEstimate: null, ...over,
  });
  beforeEach(() => {
    mock.updates.length = 0;
    mock.neu.length = 0;
  });

  it("gleicher Name auf einem weiteren Foto: größere Menge und größeres Volumen gewinnen (wie innerhalb eines Stapels)", async () => {
    mock.bestand = [zeile({})];
    const r = await fotoItemsUebernehmen("ws", "d1", [{ name: "Bett", quantity: 2, volume_cbm_estimate: 2.4, heavy: false, fragile: false, disassembly_required: true, attachmentId: "att-2" }], { analyzed: 1, skipped: 0 });
    expect(r).toEqual({ matched: 1, added: 0 });
    expect(mock.updates[0]).toMatchObject({ quantity: 2, volumeCbmEstimate: "2.4", photoAttachmentId: "att-1" });
  });

  it("kleinere Menge auf dem weiteren Foto ändert nichts an der Menge", async () => {
    mock.bestand = [zeile({ quantity: 6, volumeCbmEstimate: "1.2" })];
    await fotoItemsUebernehmen("ws", "d1", [{ name: "Bett", quantity: 1, volume_cbm_estimate: 0.5, heavy: false, fragile: false, disassembly_required: false, attachmentId: "att-2" }], { analyzed: 1, skipped: 0 });
    expect(mock.updates[0]).toMatchObject({ quantity: 6, volumeCbmEstimate: "1.2" });
  });

  it("Zeilen aus dem Chat oder vom Büro behalten ihre Menge", async () => {
    mock.bestand = [zeile({ source: "chat", volumeCbmEstimate: null, photoAttachmentId: null })];
    await fotoItemsUebernehmen("ws", "d1", [{ name: "Bett", quantity: 3, volume_cbm_estimate: 2.4, heavy: false, fragile: false, disassembly_required: false, attachmentId: "att-2" }], { analyzed: 1, skipped: 0 });
    expect(mock.updates[0]).not.toHaveProperty("quantity");
    expect(mock.updates[0]).toMatchObject({ volumeCbmEstimate: "2.4", photoAttachmentId: "att-2" });
  });
});

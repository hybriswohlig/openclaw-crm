import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ runAITask: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("./ai/run-task", () => ({ runAITask: mock.runAITask }));
vi.mock("./activity-events", () => ({ emitEvent: vi.fn() }));
vi.mock("@/services/rechner/ausloeser", () => ({ kalkulationAnstossen: vi.fn() }));
vi.mock("./deal-transcript", () => ({}));
import { PHOTO_SYSTEM_PROMPT, fotoDateinamen, fotoZuordnen, fotosErkennen } from "./deal-inventory";

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
    expect(r).toMatchObject({ ok: true, analyzed: 1, skipped: 0 });
    expect(r.ok && r.items[0]).toMatchObject({ name: "Ecksofa", attachmentId: "att-9" });
  });

  it("Fehler der KI kommt als Fehler zurück", async () => {
    mock.runAITask.mockResolvedValue({ ok: false, error: "crm-tools job timeout" });
    expect(await fotosErkennen("ws", [foto("att-9")], {})).toEqual({ ok: false, error: "crm-tools job timeout", skipped: 0 });
  });
});

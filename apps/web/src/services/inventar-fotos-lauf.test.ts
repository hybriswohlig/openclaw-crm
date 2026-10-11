import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  selects: [] as unknown[],
  inserts: [] as Array<Record<string, unknown>>,
  erkennen: vi.fn(),
  uebernehmen: vi.fn(),
  kalkulation: vi.fn(),
  senden: vi.fn(),
  insertFehler: null as null | ((v: Record<string, unknown>) => boolean),
}));

function kette(ergebnis: unknown) {
  const k: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit", "innerJoin"]) k[m] = () => k;
  k.then = (ok: (v: unknown) => unknown, nein: (e: unknown) => unknown) => Promise.resolve(ergebnis).then(ok, nein);
  return k;
}

vi.mock("@/db", () => {
  const db = {
    select: () => kette(mock.selects.shift()),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        if (mock.insertFehler?.(v)) throw new Error("Verbindung abgebrochen");
        mock.inserts.push(v);
        const r = Object.assign(Promise.resolve(undefined), { returning: async () => [{ id: mock.inserts.length }] });
        return Object.assign(r, { onConflictDoNothing: () => r });
      },
    }),
    transaction: async (schritt: (tx: unknown) => Promise<unknown>) => schritt(db),
  };
  return { db };
});
vi.mock("./deal-inventory", () => ({
  loadDealInventoryPhotos: async (_ws: string, _deal: string, ids: string[]) => ids.map((id) => ({ id })),
  fotosErkennen: mock.erkennen,
  fotoItemsUebernehmen: mock.uebernehmen,
}));
vi.mock("./rechner/ausloeser", () => ({ kalkulationAnstossen: mock.kalkulation }));
vi.mock("./intern/intern-senden", () => ({ sendeAnInterne: mock.senden }));
import { fotosAbarbeiten, fotosManuellAusgewertet } from "./inventar-fotos";

const stapel = (id: number, deal: string) => ({ id, workspaceId: "ws", dealRecordId: deal, payload: { attachmentIds: [`foto-${id}`] } });

describe("fotosAbarbeiten", () => {
  beforeEach(() => {
    mock.inserts.length = 0;
    mock.erkennen.mockReset();
    mock.uebernehmen.mockReset();
    mock.kalkulation.mockReset();
    mock.senden.mockReset();
    mock.insertFehler = null;
  });

  it("erkennt gleichzeitig, übernimmt je Lead nacheinander, rechnet einmal je Lead", async () => {
    mock.selects = [[stapel(1, "d1"), stapel(2, "d1"), stapel(3, "d2")], []];
    mock.erkennen.mockImplementation(async () => ({ ok: true, items: [{ name: "Sofa" }], analyzed: 1, skipped: 0 }));
    const aktiv = new Map<string, number>();
    let ueberlappt = false;
    mock.uebernehmen.mockImplementation(async (_ws: string, deal: string) => {
      aktiv.set(deal, (aktiv.get(deal) ?? 0) + 1);
      if ((aktiv.get(deal) ?? 0) > 1) ueberlappt = true;
      await new Promise((r) => setTimeout(r, 5));
      aktiv.set(deal, (aktiv.get(deal) ?? 0) - 1);
      return { matched: 0, added: 1 };
    });

    const ergebnis = await fotosAbarbeiten(new Date("2026-10-09T12:00:00Z"));

    expect(ergebnis.map((e) => e.stapel).sort()).toEqual([1, 2, 3]);
    expect(mock.erkennen).toHaveBeenCalledTimes(3);
    // Nicht über die 1-Platz-Hintergrundspur des VPS, sonst warten die Fotos aufeinander.
    for (const aufruf of mock.erkennen.mock.calls) expect(aufruf[2]?.background).not.toBe(true);
    expect(ueberlappt).toBe(false);
    expect(mock.kalkulation.mock.calls.map((c) => c[1]).sort()).toEqual(["d1", "d2"]);
    expect(mock.inserts.filter((v) => v.eventType === "fotos_erledigt")).toHaveLength(3);
  });

  it("Fehler der Erkennung wird als Fehlversuch gebucht, ohne Kalkulation", async () => {
    mock.selects = [[stapel(1, "d1")], []];
    mock.erkennen.mockResolvedValue({ ok: false, error: "crm-tools job timeout", skipped: 0 });

    const ergebnis = await fotosAbarbeiten(new Date("2026-10-09T12:00:00Z"));

    expect(ergebnis).toEqual([{ stapel: 1, ergebnis: "fehler: crm-tools job timeout" }]);
    expect(mock.inserts.find((v) => v.eventType === "fotos_fehler")?.payload).toMatchObject({ bezug: 1, versuch: 1 });
    expect(mock.kalkulation).not.toHaveBeenCalled();
  });

  it("gescheiterte Fotos eines Leads: eine Meldung für alle, nicht eine je Foto", async () => {
    const alt = (bezug: number) => [
      { eventType: "fotos_versuch", payload: { bezug }, createdAt: new Date("2026-10-09T10:00:00Z") },
      { eventType: "fotos_fehler", payload: { bezug, error: "crm-tools job timeout" }, createdAt: new Date("2026-10-09T10:01:00Z") },
      { eventType: "fotos_versuch", payload: { bezug }, createdAt: new Date("2026-10-09T11:00:00Z") },
      { eventType: "fotos_fehler", payload: { bezug, error: "crm-tools job timeout" }, createdAt: new Date("2026-10-09T11:01:00Z") },
    ];
    mock.selects = [[stapel(1, "d1"), stapel(2, "d1"), stapel(3, "d1")], [...alt(1), ...alt(2), ...alt(3)], [{ dealNumber: "2026-080" }], [{ text: "Jonas" }]];

    await fotosAbarbeiten(new Date("2026-10-09T12:00:00Z"));

    expect(mock.inserts.filter((v) => v.eventType === "fotos_aufgegeben")).toHaveLength(3);
    expect(mock.senden).toHaveBeenCalledTimes(1);
    expect(mock.senden.mock.calls[0][1]).toContain("3 Fotos zu Auftrag 2026-080, Jonas");
  });

  it("Datenbankfehler bei einem Foto hält die anderen und die Kalkulation nicht auf", async () => {
    mock.selects = [[stapel(1, "d1"), stapel(2, "d2")], []];
    mock.erkennen.mockResolvedValue({ ok: true, items: [{ name: "Sofa" }], analyzed: 1, skipped: 0 });
    mock.uebernehmen.mockResolvedValue({ matched: 0, added: 1 });
    mock.insertFehler = (v) => v.eventType === "fotos_erledigt" && (v.payload as { bezug?: number }).bezug === 1;

    const ergebnis = await fotosAbarbeiten(new Date("2026-10-09T12:00:00Z"));

    expect(ergebnis.find((e) => e.stapel === 1)?.ergebnis).toContain("Verbindung abgebrochen");
    expect(ergebnis.find((e) => e.stapel === 2)?.ergebnis).toBe("1 Fotos, 0 zugeordnet, 1 neu");
    expect(mock.kalkulation.mock.calls.map((c) => c[1]).sort()).toEqual(["d1", "d2"]);
  });
});

describe("fotosManuellAusgewertet", () => {
  beforeEach(() => {
    mock.inserts.length = 0;
    mock.insertFehler = null;
  });
  it("vermerkt von Hand ausgewertete Fotos als erledigten Stapel, damit das KV-Fenster nicht mehr warnt", async () => {
    await fotosManuellAusgewertet("ws", "d1", ["a", "b"]);
    expect(mock.inserts).toEqual([
      expect.objectContaining({ eventType: "fotos_offen", dealRecordId: "d1", payload: { attachmentIds: ["a", "b"], manuell: true } }),
      expect.objectContaining({ eventType: "fotos_erledigt", payload: { bezug: 1, manuell: true, analysiert: 2 }, idempotencyKey: "fotos-erledigt:1" }),
    ]);
  });
  it("nichts ausgewertet: nichts vermerken", async () => {
    await fotosManuellAusgewertet("ws", "d1", []);
    expect(mock.inserts).toEqual([]);
  });
});

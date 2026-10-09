import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  selects: [] as unknown[],
  inserts: [] as Array<Record<string, unknown>>,
  erkennen: vi.fn(),
  uebernehmen: vi.fn(),
  kalkulation: vi.fn(),
}));

function kette(ergebnis: unknown) {
  const k: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit", "innerJoin"]) k[m] = () => k;
  k.then = (ok: (v: unknown) => unknown, nein: (e: unknown) => unknown) => Promise.resolve(ergebnis).then(ok, nein);
  return k;
}

vi.mock("@/db", () => ({
  db: {
    select: () => kette(mock.selects.shift()),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        mock.inserts.push(v);
        const r = Promise.resolve(undefined);
        return { onConflictDoNothing: () => Object.assign(r, { returning: async () => [{ id: mock.inserts.length }] }) };
      },
    }),
  },
}));
vi.mock("./deal-inventory", () => ({
  loadDealInventoryPhotos: async (_ws: string, _deal: string, ids: string[]) => ids.map((id) => ({ id })),
  fotosErkennen: mock.erkennen,
  fotoItemsUebernehmen: mock.uebernehmen,
}));
vi.mock("./rechner/ausloeser", () => ({ kalkulationAnstossen: mock.kalkulation }));
vi.mock("./intern/intern-senden", () => ({ sendeAnInterne: vi.fn() }));
import { fotosAbarbeiten } from "./inventar-fotos";

const stapel = (id: number, deal: string) => ({ id, workspaceId: "ws", dealRecordId: deal, payload: { attachmentIds: [`foto-${id}`] } });

describe("fotosAbarbeiten", () => {
  beforeEach(() => {
    mock.inserts.length = 0;
    mock.erkennen.mockReset();
    mock.uebernehmen.mockReset();
    mock.kalkulation.mockReset();
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
});

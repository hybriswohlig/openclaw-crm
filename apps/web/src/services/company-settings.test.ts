import { ZAHLUNGSREGEL_STANDARD } from "@/lib/geld";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ queue: [] as unknown[][] }));
const writes = vi.hoisted(() => ({ values: vi.fn(), conflict: vi.fn() }));

vi.mock("@/db", () => {
  const chain = (): Record<string, unknown> => {
    const q: Record<string, unknown> = {};
    q.from = () => q;
    q.where = () => q;
    q.limit = async () => reads.queue.shift() ?? [];
    return q;
  };
  return {
    db: {
      select: () => chain(),
      insert: () => ({
        values: (row: unknown) => {
          writes.values(row);
          return {
            onConflictDoUpdate: async (conflict: unknown) => {
              writes.conflict(conflict);
            },
          };
        },
      }),
    },
  };
});

import { ladeFirmenEinstellungen, speichereFirmenEinstellungen } from "./company-settings";

beforeEach(() => {
  reads.queue = [];
  writes.values.mockClear();
  writes.conflict.mockClear();
});

describe("ladeFirmenEinstellungen", () => {
  it("ohne Zeile: leere Zeitposten und keine Marke", async () => {
    reads.queue = [[]];
    await expect(ladeFirmenEinstellungen("ws_1", "oc_1")).resolves.toEqual({
      zeitposten: [],
      rechnerMarke: null,
      zahlung: ZAHLUNGSREGEL_STANDARD,
      steuernummer: null,
    });
  });

  it("liest gespeicherte Vorlagen und die Marke", async () => {
    reads.queue = [[
      {
        zeitposten: [{ id: "klavier", bezeichnung: "Klavier", minuten: 90 }],
        rechnerMarke: "kottke",
        basis: "rechnungstag",
        tage: 7,
        erinnerungModus: "entwurf",
        erinnerungTage: 10,
        erinnerung2Tage: 20,
        steuernummer: " 41/123/45678 ",
      },
    ]];
    await expect(ladeFirmenEinstellungen("ws_1", "oc_1")).resolves.toEqual({
      zeitposten: [{ id: "klavier", bezeichnung: "Klavier", minuten: 90 }],
      rechnerMarke: "kottke",
      zahlung: { basis: "rechnungstag", tage: 7, erinnerungModus: "entwurf", erinnerungTage: 10, erinnerung2Tage: 20 },
      steuernummer: "41/123/45678",
    });
  });

  it("kaputte Zeitposten in der Zeile werden leer, die Marke bleibt", async () => {
    reads.queue = [[{ zeitposten: [{ minuten: 0 }], rechnerMarke: "ceylan" }]];
    await expect(ladeFirmenEinstellungen("ws_1", "oc_1")).resolves.toEqual({
      zeitposten: [],
      rechnerMarke: "ceylan",
      zahlung: ZAHLUNGSREGEL_STANDARD,
      steuernummer: null,
    });
  });
});

describe("speichereFirmenEinstellungen", () => {
  it("ohne Betriebsfirma im Workspace: null, nichts geschrieben", async () => {
    reads.queue = [[]];
    await expect(speichereFirmenEinstellungen("ws_1", "oc_fremd", { rechnerMarke: "kottke" })).resolves.toBeNull();
    expect(writes.values).not.toHaveBeenCalled();
  });

  it("Objekt da, Record fehlt: null", async () => {
    reads.queue = [[{ id: "obj_oc" }], []];
    await expect(speichereFirmenEinstellungen("ws_1", "oc_fremd", { zeitposten: [] })).resolves.toBeNull();
    expect(writes.values).not.toHaveBeenCalled();
  });

  it("null löscht die Marke, ohne die Zeitposten anzufassen", async () => {
    reads.queue = [[{ id: "obj_oc" }], [{ id: "oc_1" }]];
    await speichereFirmenEinstellungen("ws_1", "oc_1", { rechnerMarke: null });
    const set = writes.conflict.mock.calls[0]?.[0] as { set: Record<string, unknown> };
    expect(set.set.rechnerMarke).toBeNull();
    expect(set.set).not.toHaveProperty("zeitposten");
  });

  it("Zeitposten allein lassen die Marke ungeändert", async () => {
    reads.queue = [[{ id: "obj_oc" }], [{ id: "oc_1" }]];
    const zeitposten = [{ id: "klavier", bezeichnung: "Klavier", minuten: 90 }];
    await speichereFirmenEinstellungen("ws_1", "oc_1", { zeitposten });
    const set = writes.conflict.mock.calls[0]?.[0] as { set: Record<string, unknown> };
    expect(set.set.zeitposten).toEqual(zeitposten);
    expect(set.set).not.toHaveProperty("rechnerMarke");
    expect(writes.values).toHaveBeenCalledWith(expect.objectContaining({ rechnerMarke: null, zeitposten }));
  });

  it("Upsert überschreibt nur die gesendeten Felder", async () => {
    reads.queue = [[{ id: "obj_oc" }], [{ id: "oc_1" }]];
    await expect(speichereFirmenEinstellungen("ws_1", "oc_1", { rechnerMarke: "ceylan" })).resolves.toBeUndefined();
    expect(writes.values).toHaveBeenCalledWith(
      expect.objectContaining({
        operatingCompanyRecordId: "oc_1",
        workspaceId: "ws_1",
        rechnerMarke: "ceylan",
        zeitposten: [],
      })
    );
    const set = writes.conflict.mock.calls[0]?.[0] as { set: Record<string, unknown> };
    expect(set.set.rechnerMarke).toBe("ceylan");
    expect(set.set).not.toHaveProperty("zeitposten");
    expect(set.set.updatedAt).toBeInstanceOf(Date);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ rows: [] as unknown[] }));
const writes = vi.hoisted(() => ({ values: vi.fn(), conflict: vi.fn() }));

vi.mock("@/db", () => {
  const chain = (): Record<string, unknown> => {
    const q: Record<string, unknown> = {};
    q.from = () => q;
    q.where = () => q;
    q.limit = async () => reads.rows;
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

import { getUserSettings, setUiVersion } from "./user-settings";

describe("getUserSettings", () => {
  beforeEach(() => {
    reads.rows = [];
    writes.values.mockClear();
    writes.conflict.mockClear();
  });

  it("liefert ohne Zeile die alte Oberfläche und leere Ansichten", async () => {
    await expect(getUserSettings("usr_jonas")).resolves.toEqual({
      uiVersion: "alt",
      ansichten: {},
    });
  });

  it("liest eine vorhandene Zeile", async () => {
    reads.rows = [{ uiVersion: "neu", ansichten: { inbox: { filter: "offen" } } }];

    await expect(getUserSettings("usr_jonas")).resolves.toEqual({
      uiVersion: "neu",
      ansichten: { inbox: { filter: "offen" } },
    });
  });
});

describe("setUiVersion", () => {
  beforeEach(() => {
    writes.values.mockClear();
    writes.conflict.mockClear();
  });

  it("legt die Zeile an oder überschreibt die Oberfläche", async () => {
    await setUiVersion("usr_jonas", "neu");

    expect(writes.values).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "usr_jonas", uiVersion: "neu" })
    );
    expect(writes.conflict).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({ uiVersion: "neu" }),
      })
    );
  });
});

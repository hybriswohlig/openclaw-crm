import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { userSettings } from "@/db/schema";

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

import { getUserSettings, setAnsicht, setUiVersion } from "./user-settings";

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

describe("setAnsicht", () => {
  beforeEach(() => {
    writes.values.mockClear();
    writes.conflict.mockClear();
  });

  it("mergt nur den einen Schlüssel und lässt ui_version aus dem Update", async () => {
    const wert = {
      modus: "liste",
      listenSpalten: ["name"],
      sortierung: { schluessel: "wartezeit", richtung: "ab" },
    };

    await setAnsicht("usr_jonas", "leads", wert);

    const eingefuegt = writes.values.mock.calls[0][0] as Record<string, unknown>;
    expect(eingefuegt).toMatchObject({
      userId: "usr_jonas",
      ansichten: { leads: wert },
    });
    expect(eingefuegt).not.toHaveProperty("uiVersion");
    expect(eingefuegt.updatedAt).toBeInstanceOf(Date);

    const konflikt = writes.conflict.mock.calls[0][0] as {
      target: unknown;
      set: { ansichten: SQL; updatedAt: Date };
    };
    expect(konflikt.target).toBe(userSettings.userId);
    expect(konflikt.set).not.toHaveProperty("uiVersion");
    expect(Object.keys(konflikt.set).sort()).toEqual(["ansichten", "updatedAt"]);
    expect(konflikt.set.updatedAt).toBeInstanceOf(Date);

    const q = new PgDialect().sqlToQuery(konflikt.set.ansichten);
    expect(q.sql).toBe(
      '"user_settings"."ansichten" || jsonb_build_object($1::text, $2::jsonb)'
    );
    expect(q.sql).not.toContain("ui_version");
    expect(q.params).toEqual(["leads", JSON.stringify(wert)]);
  });
});

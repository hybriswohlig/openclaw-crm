import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiKeys } from "@/db/schema/api-keys";

const inserted: { values?: Record<string, unknown> } = {};
const listed: { rows: Array<Record<string, unknown>> } = { rows: [] };

vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserted.values = values;
        return {
          returning: () =>
            Promise.resolve([
              {
                id: "key1",
                name: values.name,
                scopes: values.scopes,
                expiresAt: values.expiresAt ?? null,
                createdAt: new Date("2026-10-20T00:00:00.000Z"),
              },
            ]),
        };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => Promise.resolve(listed.rows),
        }),
      }),
    }),
  },
}));

import { createApiKey, listApiKeys } from "./api-keys";

beforeEach(() => {
  inserted.values = undefined;
  listed.rows = [];
});

describe("API key scope storage", () => {
  it("inserts Nur lesen as an array so jsonb stores an array, not a string", async () => {
    const created = await createApiKey("ws1", "user1", {
      name: "Hangar",
      scopes: ["read"],
    });

    expect(inserted.values?.scopes).toEqual(["read"]);
    expect(typeof inserted.values?.scopes).not.toBe("string");
    expect(created.scopes).toEqual(["read"]);

    // The jsonb encoder serializes that array once. Serializing a string
    // again is what stored the production value "[\"read\"]".
    expect(apiKeys.scopes.mapToDriverValue(["read"])).toBe('["read"]');
    expect(JSON.parse(apiKeys.scopes.mapToDriverValue('["read"]' as unknown as string[]))).toBe(
      '["read"]'
    );
  });

  it("lists a double-encoded string and a real array as the same scopes", async () => {
    listed.rows = [
      {
        id: "old",
        keyPrefix: "oc_sk_old...",
        name: "MCP",
        scopes: '["*"]',
        expiresAt: null,
        lastUsedAt: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: "new",
        keyPrefix: "oc_sk_new...",
        name: "Hangar",
        scopes: ["read"],
        expiresAt: null,
        lastUsedAt: null,
        createdAt: new Date("2026-10-20T00:00:00.000Z"),
      },
    ];

    const keys = await listApiKeys("ws1");
    expect(keys.map((key) => key.scopes)).toEqual([["*"], ["read"]]);
  });
});

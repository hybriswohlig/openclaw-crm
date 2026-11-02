import { beforeEach, describe, expect, it, vi } from "vitest";
import { KOTTKE_OPERATING_COMPANY_ID } from "./kottke-crm-renderer";

const reads = vi.hoisted(() => ({ queue: [] as unknown[][] }));

vi.mock("@/db", () => {
  const chain = (): Record<string, unknown> => {
    const q: Record<string, unknown> = {};
    for (const method of ["from", "where", "innerJoin", "leftJoin", "orderBy"]) {
      q[method] = () => q;
    }
    q.limit = async () => reads.queue.shift() ?? [];
    return q;
  };
  return { db: { select: () => chain() } };
});

import { dealBlocksInRepoCrmRenderer } from "./kottke-crm-renderer-deal";

const CEYLAN_ID = "fbb8a6e6-e869-483b-b47d-b140dc33aa56";

describe("dealBlocksInRepoCrmRenderer", () => {
  beforeEach(() => {
    reads.queue = [];
  });

  it("blocks the known Kottke operating company without reading the name", async () => {
    reads.queue = [
      [{ id: "deals" }],
      [{ id: "oc-attr" }],
      [{ referencedRecordId: KOTTKE_OPERATING_COMPANY_ID }],
    ];
    await expect(dealBlocksInRepoCrmRenderer("ws", "deal-1")).resolves.toBe(true);
    expect(reads.queue).toEqual([]);
  });

  it("blocks a Kottke name on any other id", async () => {
    reads.queue = [
      [{ id: "deals" }],
      [{ id: "oc-attr" }],
      [{ referencedRecordId: "oc-other" }],
      [{ id: "name-attr" }],
      [{ name: "Kottke Entrümpelung & Umzüge" }],
    ];
    await expect(dealBlocksInRepoCrmRenderer("ws", "deal-1")).resolves.toBe(true);
  });

  it("does not block Ceylan or a deal without a company", async () => {
    reads.queue = [
      [{ id: "deals" }],
      [{ id: "oc-attr" }],
      [{ referencedRecordId: CEYLAN_ID }],
      [{ id: "name-attr" }],
      [{ name: "Ceylan Umzüge" }],
    ];
    await expect(dealBlocksInRepoCrmRenderer("ws", "deal-c")).resolves.toBe(false);

    reads.queue = [[{ id: "deals" }], [{ id: "oc-attr" }], []];
    await expect(dealBlocksInRepoCrmRenderer("ws", "deal-empty")).resolves.toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    select: mocks.select,
    insert: mocks.insert,
    update: mocks.update,
    transaction: mocks.transaction,
  },
}));

import { aktualisiereWartet } from "./wartet";

describe("aktualisiereWartet", () => {
  beforeEach(() => vi.clearAllMocks());

  // Review-Fokus 1: Konversation ohne Deal (deal_record_id ist null).
  it.each([null, undefined, ""])("kehrt bei Deal-Id %j ohne Datenbankzugriff zurück", async (id) => {
    await expect(aktualisiereWartet("ws-1", id)).resolves.toBeUndefined();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

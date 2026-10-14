import { describe, expect, it, vi } from "vitest";
import {
  insertOnce,
  isSameAccountMessage,
  isWhatsAppMessageConflict,
  outboundIngestPolicy,
} from "./whatsapp-outbound-policy";

const KOTTKE = "acc-kottke";
const CEYLAN = "acc-ceylan";

describe("outbound ingest policy", () => {
  it("never sends, and backfill does not take over or emit", () => {
    for (const origin of ["phone", "bridge-send", "backfill"] as const) {
      expect(outboundIngestPolicy(origin).sendsToWhatsApp).toBe(false);
    }
    const backfill = outboundIngestPolicy("backfill");
    expect(backfill.takeHumanOwnership).toBe(false);
    expect(backfill.emitSentEvent).toBe(false);
    expect(backfill.clearAiNeedsReply).toBe(false);
    expect(backfill.previewOnlyIfNewer).toBe(true);

    const bridge = outboundIngestPolicy("bridge-send");
    expect(bridge.takeHumanOwnership).toBe(false);
    expect(bridge.emitSentEvent).toBe(true);

    expect(outboundIngestPolicy("phone").takeHumanOwnership).toBe(true);
  });
});

describe("account-scoped dedupe", () => {
  function conflict(): Error {
    const err = new Error(
      'duplicate key value violates unique constraint "inbox_messages_conv_external_id_uniq"',
    );
    return Object.assign(err, { code: "23505" });
  }

  it("stores one row per account + externalMessageId and leaves the other account alone", async () => {
    type Row = { id: string; accountId: string; externalMessageId: string; body: string };
    const rows: Row[] = [];
    const send = vi.fn();

    async function record(accountId: string, externalMessageId: string, body: string) {
      const existing = rows.find((row) =>
        isSameAccountMessage(
          { accountId: row.accountId, externalMessageId: row.externalMessageId },
          { accountId, externalMessageId },
        ),
      );
      if (existing) return { duplicate: true as const, id: existing.id, body: existing.body };

      const saved = await insertOnce({
        insert: async () => {
          if (
            rows.some((row) =>
              isSameAccountMessage(
                { accountId: row.accountId, externalMessageId: row.externalMessageId },
                { accountId, externalMessageId },
              ),
            )
          ) {
            throw conflict();
          }
          const row = { id: `m${rows.length + 1}`, accountId, externalMessageId, body };
          rows.push(row);
          return row;
        },
        loadExisting: async () =>
          rows.find((row) =>
            isSameAccountMessage(
              { accountId: row.accountId, externalMessageId: row.externalMessageId },
              { accountId, externalMessageId },
            ),
          ) ?? null,
      });
      return { duplicate: saved.duplicate, id: saved.row?.id, body: saved.row?.body };
    }

    const first = await record(KOTTKE, "wamid.1", "Hallo");
    const again = await record(KOTTKE, "wamid.1", "Hallo nochmal");
    const race = await insertOnce({
      insert: async () => {
        throw conflict();
      },
      loadExisting: async () => rows.find((row) => row.accountId === KOTTKE) ?? null,
    });
    const ceylan = await record(CEYLAN, "wamid.1", "Ceylan text");

    expect(send).not.toHaveBeenCalled();
    expect(first).toMatchObject({ duplicate: false, id: "m1", body: "Hallo" });
    expect(again).toMatchObject({ duplicate: true, id: "m1", body: "Hallo" });
    expect(race).toMatchObject({ duplicate: true, row: { id: "m1", accountId: KOTTKE } });
    expect(ceylan).toMatchObject({ duplicate: false, body: "Ceylan text" });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.accountId).sort()).toEqual([CEYLAN, KOTTKE]);
    expect(isSameAccountMessage(
      { accountId: KOTTKE, externalMessageId: "wamid.1" },
      { accountId: CEYLAN, externalMessageId: "wamid.1" },
    )).toBe(false);
  });

  it("does not treat a real failure as a duplicate", async () => {
    await expect(
      insertOnce({
        insert: async () => {
          throw new Error("connection reset");
        },
        loadExisting: async () => {
          throw new Error("should not load");
        },
      }),
    ).rejects.toThrow("connection reset");
  });

  it("recognises a unique violation wrapped as cause", () => {
    const inner = Object.assign(new Error("duplicate key"), { code: "23505" });
    expect(isWhatsAppMessageConflict(new Error("insert failed", { cause: inner }))).toBe(true);
    expect(isWhatsAppMessageConflict(new Error("timeout"))).toBe(false);
  });
});

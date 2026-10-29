import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { alleVerarbeiten } from "./inbox-whatsapp-eingang";

describe("alleVerarbeiten", () => {
  it("verarbeitet alle Einträge, auch nach einem Fehler, und meldet die Fehler", async () => {
    const gesehen: number[] = [];
    const fehler = await alleVerarbeiten([1, 2, 3], async (n) => {
      gesehen.push(n);
      if (n === 2) throw new Error("kaputt");
    });
    expect(gesehen).toEqual([1, 2, 3]);
    expect(fehler).toHaveLength(1);
    expect((fehler[0] as Error).message).toBe("kaputt");
  });

  it("ohne Fehler: leere Liste", async () => {
    expect(await alleVerarbeiten(["a"], async () => {})).toEqual([]);
  });
});

// Meta und die Baileys-Bridge stellen Nachrichten manchmal doppelt zu. Ungelesen-
// Zähler, Agent und Lane-Wechsel dürfen erst nach dem Speichern laufen: Die
// doppelte Zustellung scheitert am eindeutigen Schlüssel und kehrt vorher um.
describe("ingestInboundWhatsAppMessage: erst speichern, dann zählen", () => {
  const code = readFileSync(join(__dirname, "inbox-whatsapp.ts"), "utf8");
  const start = code.indexOf("export async function ingestInboundWhatsAppMessage(");
  const ende = code.indexOf("\nexport ", start + 1);
  const fn = code.slice(start, ende);

  it("die Nachricht wird vor dem Konversations-Update gespeichert", () => {
    const insert = fn.indexOf(".insert(inboxMessages)");
    const unread = fn.indexOf("unreadCount: (conv.unreadCount ?? 0) + 1");
    expect(insert).toBeGreaterThan(0);
    expect(unread).toBeGreaterThan(0);
    expect(insert).toBeLessThan(unread);
  });
});

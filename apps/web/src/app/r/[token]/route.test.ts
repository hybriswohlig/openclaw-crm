import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Kleine Attrappe der Drizzle-Ketten: select liefert je Tabelle feste Zeilen,
// update/insert/delete werden mitgeschrieben.
const st = vi.hoisted(() => ({
  zeilen: new Map<unknown, unknown[]>(),
  updates: [] as { table: unknown; set: unknown }[],
  inserts: [] as { table: unknown; values: unknown }[],
  deletes: [] as unknown[],
}));

vi.mock("@/db", () => {
  function kette(table: unknown) {
    const k: Record<string, unknown> = {};
    for (const m of ["where", "limit", "orderBy", "innerJoin", "leftJoin"]) k[m] = () => k;
    k.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve(st.zeilen.get(table) ?? []).then(ok, err);
    return k;
  }
  return {
    db: {
      select: () => ({ from: (table: unknown) => kette(table) }),
      update: (table: unknown) => ({
        set: (set: unknown) => ({ where: async () => void st.updates.push({ table, set }) }),
      }),
      insert: (table: unknown) => ({ values: async (values: unknown) => void st.inserts.push({ table, values }) }),
      delete: (table: unknown) => ({ where: async () => void st.deletes.push(table) }),
    },
  };
});

import { GET } from "./route";
import { attributes, recordValues, records, reviewEvents, reviewTokens } from "@/db/schema";

const ZIEL = "https://g.page/r/kottke/review";
const TOKEN = {
  token: "tok_wa",
  workspaceId: "ws_1",
  dealRecordId: "deal_1",
  destinationUrl: ZIEL,
  createdAt: new Date("2026-11-10T10:00:00Z"),
  clickedAt: null as Date | null,
  clickUserAgent: null,
  clickIp: null,
};
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const aufruf = (ua: string | null, token = "tok_wa") =>
  GET(
    new NextRequest(`http://localhost/r/${token}`, { headers: ua ? { "user-agent": ua } : {} }),
    { params: Promise.resolve({ token }) }
  );

beforeEach(() => {
  st.zeilen.clear();
  st.updates.length = 0;
  st.inserts.length = 0;
  st.deletes.length = 0;
  st.zeilen.set(reviewTokens, [TOKEN]);
  st.zeilen.set(reviewEvents, [
    { eventType: "sent_sms", channel: "sms", meta: {}, at: new Date("2026-05-10T10:00:00Z") },
    { eventType: "sent_whatsapp", channel: "whatsapp", meta: { manuell: true, token: "tok_wa" }, at: new Date("2026-11-10T10:00:01Z") },
  ]);
  st.zeilen.set(records, [{ id: "deal_1", objectId: "obj_deals" }]);
  st.zeilen.set(attributes, [{ id: "attr_clicked" }]);
});

describe("GET /r/[token]", () => {
  it("unbekannter Token → deutsche 404-Seite", async () => {
    st.zeilen.set(reviewTokens, []);
    const res = await aufruf(IPHONE, "gibtsnicht");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Link nicht gefunden");
  });

  it.each([
    "WhatsApp/2.23.20.0 A",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "TelegramBot (like TwitterBot)",
  ])("Vorschau-Agent %s zählt nicht als Klick, leitet aber weiter", async (ua) => {
    const res = await aufruf(ua);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(ZIEL);
    expect(st.updates).toEqual([]);
    expect(st.inserts).toEqual([]);
    expect(st.deletes).toEqual([]);
  });

  it("erster echter Klick: Token gestempelt, Ereignis im Kanal des Versands, Deal-Feld gesetzt", async () => {
    const res = await aufruf(IPHONE);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(ZIEL);
    expect(st.updates).toHaveLength(1);
    expect(st.updates[0]!.table).toBe(reviewTokens);
    expect(st.updates[0]!.set).toMatchObject({ clickUserAgent: IPHONE, clickedAt: expect.any(Date) });
    const ereignis = st.inserts.find((i) => i.table === reviewEvents);
    expect(ereignis?.values).toMatchObject({ workspaceId: "ws_1", dealRecordId: "deal_1", eventType: "clicked", channel: "whatsapp" });
    expect(st.inserts.find((i) => i.table === recordValues)?.values).toMatchObject({
      recordId: "deal_1",
      attributeId: "attr_clicked",
      timestampValue: expect.any(Date),
    });
  });

  it("alter SMS-Token ohne Token im Ereignis bleibt sms", async () => {
    st.zeilen.set(reviewTokens, [{ ...TOKEN, token: "tok_alt", createdAt: new Date("2026-05-10T10:00:00Z") }]);
    await aufruf(IPHONE, "tok_alt");
    expect(st.inserts.find((i) => i.table === reviewEvents)?.values).toMatchObject({ channel: "sms" });
  });

  it("wiederholter Klick schreibt nichts mehr", async () => {
    st.zeilen.set(reviewTokens, [{ ...TOKEN, clickedAt: new Date("2026-11-10T11:00:00Z") }]);
    const res = await aufruf(IPHONE);
    expect(res.status).toBe(302);
    expect(st.updates).toEqual([]);
    expect(st.inserts).toEqual([]);
  });
});

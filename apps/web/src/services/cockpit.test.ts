import { describe, expect, it } from "vitest";
import { assembleCockpit, type CockpitInput } from "./cockpit";

// Donnerstag 22.10.2026, 12:00 Berlin
const NOW = new Date("2026-10-22T10:00:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

function input(overrides: Partial<CockpitInput> = {}): CockpitInput {
  return {
    now: NOW,
    appUrl: "https://crm.example",
    companies: [
      { id: "oc-k", name: "Kottke Umzüge" },
      { id: "oc-c", name: "Ceylan Umzüge" },
    ],
    conversations: [
      {
        id: "conv-1",
        dealRecordId: "deal-1",
        contactName: "Berger",
        operatingCompanyRecordId: "oc-k",
        lastMessageAt: ago(5),
        lastMessagePreview: "Geht auch Samstag?",
        aiNeedsReply: true,
        aiLastInboundAt: ago(5),
      },
      {
        id: "conv-2",
        dealRecordId: "deal-2",
        contactName: "Yilmaz",
        operatingCompanyRecordId: "oc-c",
        lastMessageAt: ago(30),
        lastMessagePreview: "Du: Angebot ist raus.",
        aiNeedsReply: false,
        aiLastInboundAt: ago(40),
      },
      {
        id: "conv-3",
        dealRecordId: null,
        contactName: "Unbekannt",
        operatingCompanyRecordId: "oc-k",
        lastMessageAt: ago(1),
        lastMessagePreview: "Hallo?",
        aiNeedsReply: true,
        aiLastInboundAt: ago(1),
      },
    ],
    deals: [
      { id: "deal-1", name: "Familie Berger", stageTitle: "In Kontakt", moveDate: "2026-11-02", fromShort: "Stuttgart", toShort: "Esslingen", operatingCompanyRecordId: "oc-k", updatedAt: ago(5) },
      { id: "deal-2", name: "Familie Yilmaz", stageTitle: "Angebot", moveDate: "2026-10-30", fromShort: "Stuttgart-Nord", toShort: null, operatingCompanyRecordId: "oc-c", updatedAt: ago(30) },
      { id: "deal-3", name: "Anfrage Website Fischer", stageTitle: "Neue Anfrage", moveDate: null, fromShort: null, toShort: null, operatingCompanyRecordId: "oc-k", updatedAt: ago(70) },
    ],
    quotations: [{ dealRecordId: "deal-2", fixedPriceEur: 1050, depositRequiredCents: 20000, createdAt: ago(30) }],
    payments: [{ dealRecordId: "deal-2", amountEur: 150 }],
    calculations: [
      { dealRecordId: "deal-1", result: { schaetzung: { festpreisVon: 980, festpreisBis: 1110, annahmen: [] }, volumen: { nettoCbm: 31.6 }, fahrzeugoptionen: [{ id: "a", name: "Sprinter", fahrten: 1, km: 18.4, fahrtMin: 30, teamgroesse: 2 }] } },
      { dealRecordId: "deal-2", result: { preis: { festpreis: 1050 }, volumen: { nettoCbm: 20 } } },
    ],
    drafts: [{ id: "a1b2c3d4-0000-4000-8000-000000000000", dealRecordId: "deal-1", conversationId: "conv-1", messageClass: "reply", text: "Samstag passt.", createdAt: ago(4), expiresAt: new Date(NOW.getTime() + 20 * 3_600_000) }],
    messages: [
      { conversationId: "conv-1", direction: "outbound", body: "Hier unser Angebot.", sentAt: ago(70), createdAt: ago(70) },
      { conversationId: "conv-1", direction: "inbound", body: "Geht auch Samstag?", sentAt: ago(5), createdAt: ago(5) },
      { conversationId: "conv-2", direction: "inbound", body: "Was kostet das?", sentAt: ago(40), createdAt: ago(40) },
      { conversationId: "conv-2", direction: "outbound", body: "Angebot ist raus.", sentAt: ago(30), createdAt: ago(30) },
    ],
    statusLinks: [],
    bridge: [
      { id: "acc-k", name: "Kottke WhatsApp", operatingCompanyRecordId: "oc-k", pairingStatus: "connected", lastSeenAt: ago(0.1) },
      { id: "acc-c", name: "Ceylan WhatsApp", operatingCompanyRecordId: "oc-c", pairingStatus: "logged_out", lastSeenAt: ago(50) },
    ],
    ...overrides,
  };
}

describe("Cockpit-Aggregat", () => {
  it("baut je Konversation mit Deal einen Vorgang, Deals ohne Chat extra, Chats ohne Deal nur als Zähler", () => {
    const out = assembleCockpit(input());
    expect(out.generatedAt).toBe(NOW.toISOString());
    expect(out.companies).toEqual([
      { id: "oc-k", name: "Kottke Umzüge" },
      { id: "oc-c", name: "Ceylan Umzüge" },
    ]);
    expect(out.unlinkedChats).toBe(1);
    expect(out.items.map((item) => item.id)).toEqual(["conv-1", "conv-2", "deal:deal-3"]);
  });

  it("füllt Fakten, Preis, Anzahlung, Entwurf, letzte Nachrichten und Links", () => {
    const out = assembleCockpit(input());
    const berger = out.items.find((item) => item.id === "conv-1")!;
    expect(berger).toMatchObject({
      conversationId: "conv-1",
      dealId: "deal-1",
      customer: "Familie Berger",
      chatName: "Berger",
      company: { id: "oc-k", name: "Kottke Umzüge" },
      stage: "In Kontakt",
      moveDate: "2026-11-02",
      fromShort: "Stuttgart",
      toShort: "Esslingen",
      distanceKm: 18.4,
      volumeM3: 31.6,
      price: { kind: "range", minCents: 98000, maxCents: 111000 },
      deposit: "unknown",
      lastMessage: { at: ago(5).toISOString(), direction: "in", preview: "Geht auch Samstag?" },
      unansweredSince: ago(5).toISOString(),
      lastOffer: null,
      urls: { deal: "https://crm.example/objects/deals/deal-1", conversation: "https://crm.example/inbox?conv=conv-1" },
    });
    expect(berger.draft).toMatchObject({ id: "a1b2c3d4-0000-4000-8000-000000000000", code: "A1B2", text: "Samstag passt.", kind: "reply" });
    expect(berger.recentMessages.map((message) => message.direction)).toEqual(["out", "in"]);

    const yilmaz = out.items.find((item) => item.id === "conv-2")!;
    expect(yilmaz).toMatchObject({
      price: { kind: "fixed", cents: 105000 },
      deposit: "open",
      lastMessage: { direction: "out", preview: "Angebot ist raus." },
      unansweredSince: null,
      lastOffer: { at: ago(30).toISOString(), cents: 105000 },
      draft: null,
    });

    const fischer = out.items.find((item) => item.id === "deal:deal-3")!;
    expect(fischer).toMatchObject({ conversationId: null, customer: "Anfrage Website Fischer", lastMessage: null, price: null, deposit: "unknown", urls: { conversation: null } });
    expect(fischer.recentMessages).toEqual([]);
  });

  it("markiert die Anzahlung als bezahlt, sobald die Zahlungen reichen, und nimmt Kundenlinks als Angebotsdatum", () => {
    const out = assembleCockpit(
      input({
        payments: [{ dealRecordId: "deal-2", amountEur: 200 }],
        quotations: [],
        statusLinks: [{ dealRecordId: "deal-2", createdAt: ago(10) }],
      }),
    );
    const yilmaz = out.items.find((item) => item.id === "conv-2")!;
    expect(yilmaz.deposit).toBe("unknown");
    expect(yilmaz.lastOffer).toEqual({ at: ago(10).toISOString(), cents: null });
    const paid = assembleCockpit(input({ payments: [{ dealRecordId: "deal-2", amountEur: 200 }] }));
    expect(paid.items.find((item) => item.id === "conv-2")?.deposit).toBe("paid");
  });

  it("lässt abgelaufene Entwürfe weg und nimmt den neuesten", () => {
    const old = { id: "old0-0000-4000-8000-000000000000", dealRecordId: "deal-1", conversationId: "conv-1", messageClass: "followup", text: "alt", createdAt: ago(10), expiresAt: ago(1) };
    const out = assembleCockpit(input({ drafts: [old, ...input().drafts] }));
    expect(out.items.find((item) => item.id === "conv-1")?.draft?.text).toBe("Samstag passt.");
    const none = assembleCockpit(input({ drafts: [old] }));
    expect(none.items.find((item) => item.id === "conv-1")?.draft).toBeNull();
  });

  it("meldet die Bridge je Konto mit Firma", () => {
    const out = assembleCockpit(input());
    expect(out.bridge).toEqual([
      { accountId: "acc-k", company: "Kottke Umzüge", connected: true, lastMessageAt: ago(0.1).toISOString() },
      { accountId: "acc-c", company: "Ceylan Umzüge", connected: false, lastMessageAt: ago(50).toISOString() },
    ]);
  });

  it("übernimmt den Kontaktnamen, wenn der Deal keinen Namen hat, und kürzt Vorschauen", () => {
    const out = assembleCockpit(
      input({
        deals: [{ id: "deal-1", name: null, stageTitle: null, moveDate: null, fromShort: null, toShort: null, operatingCompanyRecordId: null, updatedAt: ago(5) }],
        conversations: [{ ...input().conversations[0]!, lastMessagePreview: "x".repeat(400) }],
      }),
    );
    const item = out.items[0]!;
    expect(item.customer).toBe("Berger");
    expect(item.company).toEqual({ id: "oc-k", name: "Kottke Umzüge" });
    expect(item.lastMessage?.preview.length).toBeLessThanOrEqual(160);
    expect(item.stage).toBeNull();
  });
});

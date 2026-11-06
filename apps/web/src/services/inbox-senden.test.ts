import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  limit: vi.fn(),
  updates: [] as Record<string, unknown>[],
  sendWhatsAppReply: vi.fn(),
  sendBaileysReply: vi.fn(),
  sendEmailReply: vi.fn(),
  fenster: vi.fn(),
  setHumanOwned: vi.fn(),
  supersede: vi.fn(),
  letzteEigene: vi.fn(),
}));

vi.mock("@/db", () => {
  const where = () => ({ limit: mocks.limit });
  return {
    db: {
      select: () => ({
        from: () => ({
          innerJoin: () => ({ where }),
          where,
        }),
      }),
      update: () => ({
        set: (value: Record<string, unknown>) => {
          mocks.updates.push(value);
          return { where: async () => undefined };
        },
      }),
    },
  };
});

vi.mock("@/services/inbox-email", () => ({
  sendEmailReply: (...args: unknown[]) => mocks.sendEmailReply(...args),
}));

vi.mock("@/services/inbox-whatsapp", () => ({
  sendWhatsAppReply: (...args: unknown[]) => mocks.sendWhatsAppReply(...args),
  sendBaileysReply: (...args: unknown[]) => mocks.sendBaileysReply(...args),
  isWithinCustomerServiceWindow: (...args: unknown[]) => mocks.fenster(...args),
}));

vi.mock("@/services/agent/agent-gate", () => ({
  setHumanOwned: (...args: unknown[]) => mocks.setHumanOwned(...args),
}));

vi.mock("@/services/agent/draft-schliessen", () => ({
  supersedePendingDrafts: (...args: unknown[]) => mocks.supersede(...args),
}));

vi.mock("@/services/wartet", () => ({
  setzeLetzteEigeneNachricht: (...args: unknown[]) => mocks.letzteEigene(...args),
}));

import {
  GespraechNichtGefunden,
  OpenClawAusgehendFehler,
  istImFenster,
  nachEigenerNachricht,
  sendeAntwort,
  vermerkeEigeneNachricht,
} from "./inbox-senden";

const WS = "ws_kottke";
const CONV = "conv-1";

function kanal(row: Record<string, unknown>) {
  mocks.limit.mockResolvedValue([{ dealRecordId: "deal-1", ...row }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updates = [];
  mocks.sendWhatsAppReply.mockResolvedValue({ id: "wa" });
  mocks.sendBaileysReply.mockResolvedValue({ id: "baileys" });
  mocks.sendEmailReply.mockResolvedValue({ id: "mail" });
  mocks.supersede.mockResolvedValue(0);
  mocks.setHumanOwned.mockResolvedValue(undefined);
  mocks.letzteEigene.mockResolvedValue(undefined);
});

describe("sendeAntwort", () => {
  it("WABA: sendet über die Cloud API mit getrimmtem Text", async () => {
    kanal({ channelType: "whatsapp", waPhoneNumberId: "pn-1", baileysBridgeProvider: null });
    const res = await sendeAntwort({ workspaceId: WS, conversationId: CONV, body: "  Hallo " });
    expect(res).toEqual({ message: { id: "wa" }, dealRecordId: "deal-1" });
    expect(mocks.sendWhatsAppReply).toHaveBeenCalledWith({ conversationId: CONV, workspaceId: WS, body: "Hallo" });
    expect(mocks.sendBaileysReply).not.toHaveBeenCalled();
  });

  it("Baileys inhouse: sendet über die eigene Bridge", async () => {
    kanal({ channelType: "whatsapp", waPhoneNumberId: null, baileysBridgeProvider: "inhouse" });
    const res = await sendeAntwort({ workspaceId: WS, conversationId: CONV, body: "Hallo" });
    expect(res.message).toEqual({ id: "baileys" });
    expect(mocks.sendBaileysReply).toHaveBeenCalledWith({ conversationId: CONV, workspaceId: WS, body: "Hallo" });
  });

  it("E-Mail: sendet als Antwort im Faden", async () => {
    kanal({ channelType: "email", waPhoneNumberId: null, baileysBridgeProvider: null, dealRecordId: null });
    const res = await sendeAntwort({ workspaceId: WS, conversationId: CONV, body: "Hallo " });
    expect(res).toEqual({ message: { id: "mail" }, dealRecordId: null });
    expect(mocks.sendEmailReply).toHaveBeenCalledWith({ conversationId: CONV, workspaceId: WS, body: "Hallo" });
  });

  it("OpenClaw: wirft OpenClawAusgehendFehler und sendet nichts", async () => {
    kanal({ channelType: "whatsapp", waPhoneNumberId: null, baileysBridgeProvider: "openclaw" });
    await expect(sendeAntwort({ workspaceId: WS, conversationId: CONV, body: "Hallo" })).rejects.toBeInstanceOf(
      OpenClawAusgehendFehler
    );
    expect(mocks.sendBaileysReply).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppReply).not.toHaveBeenCalled();
    expect(mocks.sendEmailReply).not.toHaveBeenCalled();
  });

  it("unbekanntes Gespräch: wirft GespraechNichtGefunden", async () => {
    mocks.limit.mockResolvedValue([]);
    await expect(sendeAntwort({ workspaceId: WS, conversationId: CONV, body: "Hallo" })).rejects.toBeInstanceOf(
      GespraechNichtGefunden
    );
  });

  it("Fehler der Sendedienste gehen unverändert durch und lösen keine Nebenwirkung aus", async () => {
    kanal({ channelType: "whatsapp", waPhoneNumberId: null, baileysBridgeProvider: "inhouse" });
    const fehler = new Error("bridge down");
    mocks.sendBaileysReply.mockRejectedValue(fehler);
    await expect(sendeAntwort({ workspaceId: WS, conversationId: CONV, body: "Hallo" })).rejects.toBe(fehler);
    expect(mocks.updates).toEqual([]);
    expect(mocks.supersede).not.toHaveBeenCalled();
  });
});

describe("nachEigenerNachricht", () => {
  const gesendet = new Date("2026-11-05T09:15:00Z");
  const basis = { workspaceId: WS, conversationId: CONV, userId: "usr_1", sentAt: gesendet };

  it("pausiert, vermerkt, schließt Entwürfe und übernimmt den Deal", async () => {
    await nachEigenerNachricht({ ...basis, dealRecordId: "deal-1", deduped: false });
    expect(mocks.updates).toEqual([{ aiPaused: true, aiNeedsReply: false, updatedAt: expect.any(Date) }]);
    expect(mocks.letzteEigene).toHaveBeenCalledWith("deal-1", gesendet);
    expect(mocks.supersede).toHaveBeenCalledWith({
      workspaceId: WS,
      conversationId: CONV,
      dealRecordId: "deal-1",
      userId: "usr_1",
      supersededBy: "manual_send",
    });
    expect(mocks.setHumanOwned).toHaveBeenCalledWith(WS, "deal-1", "usr_1");
  });

  it("dedupliziert: kein Vermerk, der Rest wie sonst", async () => {
    await nachEigenerNachricht({ ...basis, dealRecordId: "deal-1", deduped: true });
    expect(mocks.letzteEigene).not.toHaveBeenCalled();
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.supersede).toHaveBeenCalledOnce();
    expect(mocks.setHumanOwned).toHaveBeenCalledOnce();
  });

  it("ohne Deal: nur Pause und Entwürfe am Gespräch", async () => {
    await nachEigenerNachricht({ ...basis, dealRecordId: null, deduped: false });
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.letzteEigene).not.toHaveBeenCalled();
    expect(mocks.setHumanOwned).not.toHaveBeenCalled();
    expect(mocks.supersede).toHaveBeenCalledWith(expect.objectContaining({ dealRecordId: null }));
  });

  it("Fehler in Vermerk, Entwürfen oder Übernahme werfen nicht", async () => {
    mocks.letzteEigene.mockRejectedValue(new Error("a"));
    mocks.supersede.mockRejectedValue(new Error("b"));
    mocks.setHumanOwned.mockRejectedValue(new Error("c"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(nachEigenerNachricht({ ...basis, dealRecordId: "deal-1", deduped: false })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(3);
    log.mockRestore();
  });
});

describe("vermerkeEigeneNachricht", () => {
  const gesendet = new Date("2026-11-05T10:00:00Z");

  it("vermerkt am Deal des Gesprächs", async () => {
    mocks.limit.mockResolvedValue([{ dealRecordId: "deal-7" }]);
    await vermerkeEigeneNachricht({ workspaceId: WS, conversationId: CONV, sentAt: gesendet });
    expect(mocks.letzteEigene).toHaveBeenCalledWith("deal-7", gesendet);
  });

  it("ohne Deal oder ohne Gespräch: nichts", async () => {
    mocks.limit.mockResolvedValue([{ dealRecordId: null }]);
    await vermerkeEigeneNachricht({ workspaceId: WS, conversationId: CONV, sentAt: gesendet });
    mocks.limit.mockResolvedValue([]);
    await vermerkeEigeneNachricht({ workspaceId: WS, conversationId: CONV, sentAt: gesendet });
    await vermerkeEigeneNachricht({ workspaceId: WS, conversationId: null, sentAt: gesendet });
    expect(mocks.letzteEigene).not.toHaveBeenCalled();
    expect(mocks.limit).toHaveBeenCalledTimes(2);
  });

  it("ein Fehler wirft nicht", async () => {
    mocks.limit.mockRejectedValue(new Error("db down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      vermerkeEigeneNachricht({ workspaceId: WS, conversationId: CONV, sentAt: gesendet })
    ).resolves.toBeUndefined();
    log.mockRestore();
  });
});

describe("istImFenster", () => {
  it("WABA: Antwort des 24-Stunden-Fensters", async () => {
    mocks.limit.mockResolvedValue([{ channelType: "whatsapp", waPhoneNumberId: "pn-1" }]);
    mocks.fenster.mockResolvedValue(true);
    expect(await istImFenster(CONV)).toBe(true);
    mocks.fenster.mockResolvedValue(false);
    expect(await istImFenster(CONV)).toBe(false);
    expect(mocks.fenster).toHaveBeenCalledWith(CONV);
  });

  it("Baileys, E-Mail und unbekannt: null ohne Fensterabfrage", async () => {
    mocks.limit.mockResolvedValue([{ channelType: "whatsapp", waPhoneNumberId: null }]);
    expect(await istImFenster(CONV)).toBeNull();
    mocks.limit.mockResolvedValue([{ channelType: "email", waPhoneNumberId: null }]);
    expect(await istImFenster(CONV)).toBeNull();
    mocks.limit.mockResolvedValue([]);
    expect(await istImFenster(CONV)).toBeNull();
    expect(mocks.fenster).not.toHaveBeenCalled();
  });
});

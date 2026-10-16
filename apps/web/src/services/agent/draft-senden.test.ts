import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selects: [] as unknown[],
  updateReturns: [] as unknown[],
  sets: [] as Record<string, unknown>[],
  inserts: [] as Record<string, unknown>[],
  conflictSets: [] as Record<string, unknown>[],
  gate: vi.fn(),
  send: vi.fn(),
  docs: vi.fn(),
  leak: vi.fn(),
  optOut: vi.fn(async () => false),
}));

function chain(result: unknown) {
  const q: Record<string, unknown> = {};
  const self = () => q;
  for (const method of ["from", "where", "innerJoin", "leftJoin", "limit", "onConflictDoNothing"]) {
    q[method] = self;
  }
  q.onConflictDoUpdate = (cfg: { set: Record<string, unknown> }) => {
    mocks.conflictSets.push(cfg.set);
    return q;
  };
  q.set = (value: Record<string, unknown>) => {
    mocks.sets.push(value);
    return q;
  };
  q.values = (value: Record<string, unknown>) => {
    mocks.inserts.push(value);
    return q;
  };
  q.returning = () => Promise.resolve(result);
  q.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(ok, err);
  return q;
}

vi.mock("@/db", () => ({
  db: {
    select: () => chain(mocks.selects.shift() ?? []),
    update: () => chain(mocks.updateReturns.shift() ?? []),
    insert: () => chain(undefined),
  },
}));

vi.mock("@/services/agent/agent-gate", () => ({
  agentMayContact: (...args: unknown[]) => mocks.gate(...args),
  toGateMessageClass: (messageClass: string) => messageClass,
}));

vi.mock("@/services/agent/agent-shared", () => ({
  sendOnChannel: (...args: unknown[]) => mocks.send(...args),
}));

vi.mock("@/services/baileys-document-send", () => ({
  sendConversationDocuments: (...args: unknown[]) => mocks.docs(...args),
}));

vi.mock("@/services/agent/agent-suppress", async () => {
  const actual = await vi.importActual<typeof import("@/services/agent/agent-suppress")>(
    "@/services/agent/agent-suppress"
  );
  return {
    ...actual,
    leaksPriceOrCommitment: (text: string) => mocks.leak(text),
  };
});

vi.mock("@/services/agent/agent-config", () => ({
  isOptOutLineEnabled: () => mocks.optOut(),
}));

vi.mock("@/services/inbox-whatsapp", () => {
  class WhatsAppSessionExpiredError extends Error {
    constructor() {
      super("session");
      this.name = "WhatsAppSessionExpiredError";
    }
  }
  class BaileysBridgeNotConfiguredError extends Error {}
  class BaileysMediaTooLargeError extends Error {}
  return { WhatsAppSessionExpiredError, BaileysBridgeNotConfiguredError, BaileysMediaTooLargeError };
});

import { entwurfFreigebenUndSenden } from "./draft-senden";
import { WhatsAppSessionExpiredError } from "@/services/inbox-whatsapp";

const DRAFT = {
  id: "draft-1",
  workspaceId: "ws",
  dealRecordId: "deal-1",
  conversationId: "conv-1",
  messageClass: "reply",
  draftText: "Hallo, wir melden uns.",
  finalText: null,
  filterVerdicts: { priceOrCommitmentLeak: false },
  status: "approved",
};

const CONV = [
  {
    id: "conv-1",
    channelType: "whatsapp",
    waPhoneNumberId: null,
    baileysBridgeProvider: "inhouse",
    contactPhone: "491701234567",
    contactEmail: null,
    personRecordId: "person-1",
  },
];

function reset() {
  mocks.selects = [];
  mocks.updateReturns = [];
  mocks.sets = [];
  mocks.inserts = [];
  mocks.conflictSets = [];
  mocks.gate.mockReset();
  mocks.send.mockReset();
  mocks.docs.mockReset();
  mocks.docs.mockResolvedValue({ message: { id: "doc" }, messages: [], deduped: false, conversationId: "conv-1" });
  mocks.leak.mockReset();
  mocks.optOut.mockReset();
  mocks.leak.mockReturnValue(false);
  mocks.optOut.mockResolvedValue(false);
  mocks.send.mockResolvedValue(undefined);
}

beforeEach(reset);

describe("entwurfFreigebenUndSenden human approval", () => {
  it("blocks human_owned and ai_paused when nobody approved", async () => {
    mocks.updateReturns = [[DRAFT], []];
    mocks.selects = [CONV];
    mocks.gate.mockResolvedValue({
      allowed: false,
      reasons: ["human_owned", "ai_paused"],
      context: {},
    });

    const result = await entwurfFreigebenUndSenden({
      workspaceId: "ws",
      userId: "user-1",
      draftId: "draft-1",
    });

    expect(result).toEqual({
      ok: false,
      fehler: "gate_blocked",
      reasons: ["human_owned", "ai_paused"],
    });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.sets.some((set) => set.status === "pending")).toBe(true);
  });

  it("sends when a human approved and leaves ownership flags untouched", async () => {
    mocks.updateReturns = [[{ ...DRAFT }], [], []];
    mocks.selects = [CONV, [{ status: "approved" }]];
    mocks.gate.mockResolvedValue({
      allowed: false,
      reasons: ["human_owned", "ai_paused"],
      context: {},
    });

    const result = await entwurfFreigebenUndSenden({
      workspaceId: "ws",
      userId: "user-1",
      draftId: "draft-1",
      humanApproved: true,
      approvedBy: "Dario",
      note: "bitte so raus",
    });

    expect(result.ok).toBe(true);
    expect(mocks.send).toHaveBeenCalledOnce();
    const audit = mocks.inserts.find((row) => row.eventType === "human_approved");
    expect(audit?.payload).toMatchObject({
      draftId: "draft-1",
      approvedBy: "Dario",
      note: "bitte so raus",
      overrideConsent: false,
    });
    const sent = mocks.inserts.find((row) => row.eventType === "sent");
    expect(sent?.payload).toMatchObject({
      humanApproved: true,
      approvedBy: "Dario",
      note: "bitte so raus",
      overrideConsent: false,
      consentOverridden: false,
    });
    const stateInsert = mocks.inserts.find((row) => row.dealRecordId === "deal-1" && !row.eventType);
    expect(stateInsert).toBeDefined();
    expect(stateInsert).not.toHaveProperty("humanOwned");
    expect(mocks.conflictSets).toEqual([
      expect.objectContaining({ lastOutboundAt: expect.any(Date), updatedAt: expect.any(Date) }),
    ]);
    for (const touch of mocks.conflictSets) {
      expect(touch).not.toHaveProperty("humanOwned");
      expect(Object.keys(touch).sort()).toEqual(["lastOutboundAt", "updatedAt"]);
    }
    for (const set of mocks.sets) {
      expect(set).not.toHaveProperty("aiPaused");
      expect(set.humanOwned).not.toBe(false);
    }
  });

  it("still blocks no_proactive_consent until overrideConsent is set with the approval", async () => {
    mocks.updateReturns = [[{ ...DRAFT }], []];
    mocks.selects = [CONV];
    mocks.gate.mockResolvedValue({
      allowed: false,
      reasons: ["no_proactive_consent", "human_owned"],
      context: {},
    });

    const blocked = await entwurfFreigebenUndSenden({
      workspaceId: "ws",
      userId: null,
      draftId: "draft-1",
      humanApproved: true,
      overrideConsent: false,
    });
    expect(blocked).toMatchObject({
      ok: false,
      fehler: "gate_blocked",
      reasons: ["no_proactive_consent"],
    });

    reset();
    mocks.updateReturns = [[{ ...DRAFT }], [], []];
    mocks.selects = [CONV, [{ status: "approved" }]];
    mocks.gate.mockResolvedValue({
      allowed: false,
      reasons: ["no_proactive_consent", "ai_paused"],
      context: {},
    });
    mocks.leak.mockReturnValue(false);
    mocks.send.mockResolvedValue(undefined);

    const sent = await entwurfFreigebenUndSenden({
      workspaceId: "ws",
      userId: null,
      draftId: "draft-1",
      humanApproved: true,
      approvedBy: "Dario",
      overrideConsent: true,
    });
    expect(sent.ok).toBe(true);
    const audit = mocks.inserts.find((row) => row.eventType === "human_approved");
    expect(audit?.payload).toMatchObject({ overrideConsent: true, approvedBy: "Dario" });
    const delivery = mocks.inserts.find((row) => row.eventType === "sent");
    expect(delivery?.payload).toMatchObject({ overrideConsent: true, consentOverridden: true });
  });

  it("still blocks a price leak and a dead session after human approval", async () => {
    mocks.updateReturns = [[{ ...DRAFT }], []];
    mocks.selects = [CONV];
    mocks.gate.mockResolvedValue({ allowed: true, reasons: [], context: {} });
    mocks.leak.mockReturnValue(true);

    const leak = await entwurfFreigebenUndSenden({
      workspaceId: "ws",
      userId: "user-1",
      draftId: "draft-1",
      humanApproved: true,
    });
    expect(leak).toEqual({ ok: false, fehler: "price_leak" });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.docs).not.toHaveBeenCalled();

    reset();
    mocks.updateReturns = [[{ ...DRAFT }], []];
    mocks.selects = [CONV, [{ status: "approved" }]];
    mocks.gate.mockResolvedValue({ allowed: true, reasons: ["human_owned"], context: {} });
    mocks.send.mockRejectedValue(new WhatsAppSessionExpiredError());

    const session = await entwurfFreigebenUndSenden({
      workspaceId: "ws",
      userId: "user-1",
      draftId: "draft-1",
      humanApproved: true,
    });
    expect(session).toMatchObject({ ok: false, fehler: "session_expired" });
  });

  it("does not send attachments when the final text leaks a price", async () => {
    mocks.updateReturns = [[{ ...DRAFT, draftText: "Festpreis 1.200 €" }], []];
    mocks.selects = [CONV];
    mocks.gate.mockResolvedValue({ allowed: true, reasons: [], context: {} });
    mocks.leak.mockReturnValue(true);

    const leak = await entwurfFreigebenUndSenden({
      workspaceId: "ws",
      userId: "user-1",
      draftId: "draft-1",
      humanApproved: true,
      attachments: [{ kind: "dealDocument", dealDocumentId: "doc-1" }],
    });
    expect(leak).toEqual({ ok: false, fehler: "price_leak" });
    expect(mocks.docs).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("sends documents only after the gate, and not as a plain text", async () => {
    mocks.updateReturns = [[{ ...DRAFT }], [], []];
    mocks.selects = [CONV, [{ status: "approved" }]];
    mocks.gate.mockResolvedValue({ allowed: true, reasons: [], context: {} });

    const sent = await entwurfFreigebenUndSenden({
      workspaceId: "ws",
      userId: "user-1",
      draftId: "draft-1",
      humanApproved: true,
      attachments: [{ kind: "dealDocument", dealDocumentId: "doc-1" }],
      idempotencyKey: "k1",
    });
    expect(sent.ok).toBe(true);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.docs).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-1",
        dealRecordId: "deal-1",
        body: DRAFT.draftText,
        idempotencyKey: "k1",
        attachments: [{ kind: "dealDocument", dealDocumentId: "doc-1" }],
      })
    );
  });
});

describe("entwurfFreigebenUndSenden opt-out footer", () => {
  const SIE_TEXT = "Guten Tag, wir erstellen Ihnen das Angebot, sobald die Fotos da sind.";
  const DU_TEXT = "Hallo, kannst du uns noch die Fotos schicken?";
  const OFFEN = "Guten Tag, kurze Nachfrage zum Umzug.";

  function freigabe(draft: typeof DRAFT) {
    mocks.updateReturns = [[draft], [], []];
    mocks.gate.mockResolvedValue({ allowed: true, reasons: [], context: {} });
    mocks.optOut.mockResolvedValue(true);
  }

  it("hängt bei einer Sie-Nachricht die Sie-Zeile an", async () => {
    freigabe({ ...DRAFT, messageClass: "followup", draftText: SIE_TEXT });
    mocks.selects = [CONV, [{ register: null }], [{ agentState: null }], [{ status: "approved" }]];

    const result = await entwurfFreigebenUndSenden({
      workspaceId: "ws",
      userId: "user-1",
      draftId: "draft-1",
      humanApproved: true,
      overrideConsent: true,
    });

    expect(result.ok).toBe(true);
    const text = mocks.send.mock.calls[0]?.[1] as string;
    expect(text).toContain("Wenn Sie keine Nachrichten mehr von uns wünschen, antworten Sie einfach mit STOP.");
    expect(text).not.toContain("Wenn du keine Nachrichten mehr");
  });

  it("hängt bei einer Du-Nachricht die Du-Zeile an", async () => {
    freigabe({ ...DRAFT, messageClass: "first_contact", draftText: DU_TEXT });
    mocks.selects = [CONV, [{ register: "sie" }], [{ agentState: { register: "sie" } }], [{ status: "approved" }]];

    await entwurfFreigebenUndSenden({
      workspaceId: "ws",
      userId: "user-1",
      draftId: "draft-1",
      humanApproved: true,
    });

    const text = mocks.send.mock.calls[0]?.[1] as string;
    expect(text).toContain("Wenn du keine Nachrichten mehr von uns willst, antworte einfach mit STOP.");
  });

  it("nimmt die gespeicherte Anrede, wenn der Text keine Pronomen hat", async () => {
    freigabe({ ...DRAFT, messageClass: "followup", draftText: OFFEN });
    mocks.selects = [CONV, [{ register: "du" }], [{ agentState: null }], [{ status: "approved" }]];

    await entwurfFreigebenUndSenden({
      workspaceId: "ws",
      userId: "user-1",
      draftId: "draft-1",
      humanApproved: true,
      overrideConsent: true,
    });

    const text = mocks.send.mock.calls[0]?.[1] as string;
    expect(text).toContain("Wenn du keine Nachrichten mehr von uns willst");
  });

  it("hängt die Zeile nicht doppelt an und nicht an Antworten", async () => {
    const schon = `${SIE_TEXT}\n\nPS: Wenn Sie keine Nachrichten mehr von uns wünschen, antworten Sie einfach mit STOP.`;
    freigabe({ ...DRAFT, messageClass: "followup", draftText: schon });
    mocks.selects = [CONV, [{ register: null }], [{ agentState: null }], [{ status: "approved" }]];

    await entwurfFreigebenUndSenden({
      workspaceId: "ws",
      userId: "user-1",
      draftId: "draft-1",
      humanApproved: true,
      overrideConsent: true,
    });
    expect(mocks.send.mock.calls[0]?.[1]).toBe(schon);

    reset();
    freigabe({ ...DRAFT, messageClass: "reply", draftText: SIE_TEXT });
    mocks.selects = [CONV, [{ status: "approved" }]];
    await entwurfFreigebenUndSenden({
      workspaceId: "ws",
      userId: "user-1",
      draftId: "draft-1",
      humanApproved: true,
    });
    expect(mocks.send.mock.calls[0]?.[1]).toBe(SIE_TEXT);
  });

  it("hängt ohne eingeschaltete Opt-out-Zeile nichts an", async () => {
    mocks.updateReturns = [[{ ...DRAFT, messageClass: "followup", draftText: SIE_TEXT }], [], []];
    mocks.selects = [CONV, [{ status: "approved" }]];
    mocks.gate.mockResolvedValue({ allowed: true, reasons: [], context: {} });
    mocks.optOut.mockResolvedValue(false);

    await entwurfFreigebenUndSenden({
      workspaceId: "ws",
      userId: "user-1",
      draftId: "draft-1",
      humanApproved: true,
      overrideConsent: true,
    });
    expect(mocks.send.mock.calls[0]?.[1]).toBe(SIE_TEXT);
  });

  it("hängt die Sie-Zeile auch an den Text eines Dokumentenversands", async () => {
    freigabe({ ...DRAFT, messageClass: "followup", draftText: SIE_TEXT });
    mocks.selects = [CONV, [{ register: null }], [{ agentState: null }], [{ status: "approved" }]];

    const result = await entwurfFreigebenUndSenden({
      workspaceId: "ws",
      userId: "user-1",
      draftId: "draft-1",
      humanApproved: true,
      overrideConsent: true,
      attachments: [{ kind: "dealDocument", dealDocumentId: "doc-1" }],
    });

    expect(result.ok).toBe(true);
    expect(mocks.send).not.toHaveBeenCalled();
    const body = mocks.docs.mock.calls[0]?.[0] as { body: string };
    expect(body.body).toContain(SIE_TEXT);
    expect(body.body).toContain("Wenn Sie keine Nachrichten mehr von uns wünschen, antworten Sie einfach mit STOP.");
    expect(body.body).not.toContain("Wenn du keine Nachrichten mehr");
  });
});

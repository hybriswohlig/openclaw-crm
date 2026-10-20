import { describe, expect, it } from "vitest";
import {
  CEYLAN_CHANNEL_ACCOUNT_PREFIX,
  DEFAULT_CONFIDENCE_THRESHOLD,
  enrichmentEvidenceKey,
  evaluateDealEnrichment,
  hasExplicitLossEvidence,
  isCeylanChannelAccount,
  type DealEnrichmentPolicyInput,
  type PolicyProposal,
  type PolicySource,
} from "./deal-enrichment-policy";

const channels = [
  { id: "wa", title: "WhatsApp" },
  { id: "phone", title: "Telefon" },
];
const reasons = [
  { id: "vendor", title: "anderer Anbieter" },
  { id: "misc", title: "Sonstiges" },
  { id: "cancel", title: "Umzug abgesagt" },
];
const stages = [
  { id: "new", title: "Neue Anfrage", sortOrder: 0, stageCategory: "open_new" },
  { id: "contact", title: "In Kontakt", sortOrder: 1, stageCategory: "open_engaged" },
  { id: "quoted", title: "Angebot", sortOrder: 2, stageCategory: "quoted" },
  { id: "booked", title: "Geplant", sortOrder: 3, stageCategory: "booked" },
  { id: "done", title: "Durchgeführt", sortOrder: 4, stageCategory: "done_unpaid" },
  { id: "paid", title: "Bezahlt", sortOrder: 5, stageCategory: "paid" },
  { id: "lost", title: "Verloren", sortOrder: 6, stageCategory: "lost" },
];

const customerText = "Wir haben schon jemanden gefunden, danke.";

function source(partial?: Partial<PolicySource>): PolicySource {
  return {
    id: "m1",
    kind: "message",
    text: `Guten Tag, ich komme über WhatsApp. ${customerText}`,
    direction: "inbound",
    ...partial,
  };
}

function proposal(partial: Partial<PolicyProposal> & Pick<PolicyProposal, "field" | "value">): PolicyProposal {
  return {
    confidence: 0.92,
    reason: "steht im Chat",
    evidenceQuote: "ich komme über WhatsApp",
    evidenceSourceId: "m1",
    evidenceSourceKind: "message",
    ...partial,
  };
}

function run(partial: Partial<DealEnrichmentPolicyInput> = {}) {
  const input: DealEnrichmentPolicyInput = {
    proposals: [],
    currentValues: {},
    selectOptions: { source_channel: channels, loss_reason: reasons },
    stages,
    sources: [source()],
    threshold: DEFAULT_CONFIDENCE_THRESHOLD,
    suggestionsEnabled: true,
    autoWriteEnabled: true,
    skip: {
      ceylanChannelAccount: false,
      internalNumber: false,
      humanOwned: false,
      aiPaused: false,
    },
    rejectedEvidenceKeys: new Set(),
    ...partial,
  };
  return evaluateDealEnrichment(input);
}

describe("deal enrichment policy", () => {
  it("auto-writes an empty select when confidence clears the threshold and the quote is in the source", () => {
    const result = run({
      proposals: [proposal({ field: "source_channel", value: "WhatsApp" })],
    });
    expect(result.skipped).toBeUndefined();
    expect(result.decisions).toEqual([
      expect.objectContaining({
        action: "auto_write",
        field: "source_channel",
        value: "wa",
        label: "WhatsApp",
      }),
    ]);
  });

  it("turns a lower confidence into a suggestion", () => {
    const result = run({
      proposals: [proposal({ field: "source_channel", value: "wa", confidence: 0.7 })],
    });
    expect(result.decisions[0]).toMatchObject({ action: "suggest", value: "wa" });
  });

  it("respects a higher configured threshold", () => {
    const result = run({
      threshold: 0.95,
      proposals: [proposal({ field: "source_channel", value: "wa", confidence: 0.9 })],
    });
    expect(result.decisions[0]).toMatchObject({ action: "suggest" });
  });

  it("does not overwrite a field that already has a value", () => {
    const result = run({
      currentValues: { source_channel: "phone", source_detail: "Anzeige 12" },
      proposals: [
        proposal({ field: "source_channel", value: "WhatsApp" }),
        proposal({
          field: "source_detail",
          value: "andere Anzeige",
          evidenceQuote: "ich komme über WhatsApp",
        }),
      ],
    });
    expect(result.decisions.map((decision) => decision.reason)).toEqual(["not_empty", "not_empty"]);
  });

  it("drops a quote that is not verbatim in the cited source", () => {
    const result = run({
      proposals: [
        proposal({
          field: "source_channel",
          value: "WhatsApp",
          evidenceQuote: "kam über Instagram",
        }),
      ],
    });
    expect(result.decisions[0]).toMatchObject({ action: "drop", reason: "evidence_not_in_source" });
  });

  it("drops a quote that lives in a different message than the cited id", () => {
    const result = run({
      sources: [
        source({ id: "m1", text: "nur ein Hallo" }),
        source({ id: "m2", text: "ich komme über WhatsApp" }),
      ],
      proposals: [proposal({ field: "source_channel", value: "WhatsApp", evidenceSourceId: "m1" })],
    });
    expect(result.decisions[0]).toMatchObject({ reason: "evidence_not_in_source" });
  });

  it("drops a value that is not an existing option", () => {
    const result = run({
      proposals: [proposal({ field: "source_channel", value: "Instagram" })],
    });
    expect(result.decisions[0]).toMatchObject({ reason: "unknown_option" });
  });

  it("skips the Ceylan channel account, internal numbers, human-owned and paused threads", () => {
    expect(isCeylanChannelAccount(`${CEYLAN_CHANNEL_ACCOUNT_PREFIX}-aaaa`)).toBe(true);
    expect(isCeylanChannelAccount("other-account")).toBe(false);
    expect(run({ skip: { ceylanChannelAccount: true, internalNumber: false, humanOwned: false, aiPaused: false } }).skipped?.reason).toBe(
      "ceylan_channel_account"
    );
    expect(run({ skip: { ceylanChannelAccount: false, internalNumber: true, humanOwned: false, aiPaused: false } }).skipped?.reason).toBe(
      "internal_number"
    );
    expect(run({ skip: { ceylanChannelAccount: false, internalNumber: false, humanOwned: true, aiPaused: false } }).skipped?.reason).toBe(
      "human_owned"
    );
    expect(run({ skip: { ceylanChannelAccount: false, internalNumber: false, humanOwned: false, aiPaused: true } }).skipped?.reason).toBe(
      "ai_paused"
    );
  });

  it("moves an open stage forward and refuses a backwards move", () => {
    const forward = run({
      currentValues: { stage: "contact" },
      proposals: [
        proposal({
          field: "stage",
          value: "Angebot",
          evidenceQuote: "ich komme über WhatsApp",
        }),
      ],
    });
    expect(forward.decisions[0]).toMatchObject({ action: "auto_write", value: "quoted" });

    const backward = run({
      currentValues: { stage: "quoted" },
      proposals: [
        proposal({
          field: "stage",
          value: "Neue Anfrage",
          evidenceQuote: "ich komme über WhatsApp",
        }),
      ],
    });
    expect(backward.decisions[0]).toMatchObject({ action: "drop", reason: "backwards" });
  });

  it("does not move a won or paid deal and does not move a deal into paid", () => {
    const paid = run({
      currentValues: { stage: "paid" },
      proposals: [proposal({ field: "stage", value: "Verloren", evidenceQuote: customerText })],
    });
    expect(paid.decisions[0]).toMatchObject({ reason: "won_or_paid" });

    const intoPaid = run({
      currentValues: { stage: "booked" },
      proposals: [proposal({ field: "stage", value: "Bezahlt" })],
    });
    expect(intoPaid.decisions[0]).toMatchObject({ reason: "won_or_paid_target" });
  });

  it("moves to lost only with explicit customer evidence and a loss reason", () => {
    expect(hasExplicitLossEvidence("Wir haben schon jemanden")).toBe(true);
    const missingPhrase = run({
      currentValues: { stage: "contact" },
      proposals: [
        proposal({ field: "stage", value: "Verloren", evidenceQuote: "ich komme über WhatsApp" }),
        proposal({ field: "loss_reason", value: "anderer Anbieter", evidenceQuote: "ich komme über WhatsApp" }),
      ],
    });
    expect(missingPhrase.decisions.find((decision) => decision.field === "stage")).toMatchObject({
      reason: "explicit_loss_evidence",
    });

    const missingReason = run({
      currentValues: { stage: "contact" },
      proposals: [proposal({ field: "stage", value: "lost", evidenceQuote: customerText })],
    });
    expect(missingReason.decisions.find((decision) => decision.field === "stage")).toMatchObject({
      reason: "loss_reason_required",
    });

    const outbound = run({
      sources: [source({ direction: "outbound", text: customerText })],
      currentValues: { stage: "contact" },
      proposals: [
        proposal({ field: "stage", value: "Verloren", evidenceQuote: customerText }),
        proposal({ field: "loss_reason", value: "vendor", evidenceQuote: customerText }),
      ],
    });
    expect(outbound.decisions.find((decision) => decision.field === "stage")).toMatchObject({
      reason: "not_customer_evidence",
    });

    const ok = run({
      currentValues: { stage: "contact" },
      proposals: [
        proposal({ field: "stage", value: "Verloren", evidenceQuote: customerText, confidence: 0.95 }),
        proposal({ field: "loss_reason", value: "anderer Anbieter", evidenceQuote: customerText, confidence: 0.95 }),
      ],
    });
    expect(ok.decisions.find((decision) => decision.field === "stage")).toMatchObject({
      action: "auto_write",
      value: "lost",
    });
    expect(ok.decisions.find((decision) => decision.field === "loss_reason")).toMatchObject({
      action: "auto_write",
      value: "vendor",
    });
  });

  it("requires a note when the loss reason is Sonstiges and keeps the bundle at suggestion level", () => {
    const note = "Kunde zieht den Umzug vorerst nicht durch.";
    const sources = [source({ text: `${customerText} ${note}` })];
    const withoutNote = run({
      sources,
      currentValues: { stage: "contact" },
      proposals: [
        proposal({ field: "stage", value: "Verloren", evidenceQuote: customerText }),
        proposal({ field: "loss_reason", value: "Sonstiges", evidenceQuote: customerText }),
      ],
    });
    expect(withoutNote.decisions.find((decision) => decision.field === "stage")).toMatchObject({
      reason: "loss_note_required",
    });

    const mixed = run({
      sources,
      currentValues: { stage: "contact" },
      proposals: [
        proposal({ field: "stage", value: "Verloren", evidenceQuote: customerText, confidence: 0.95 }),
        proposal({ field: "loss_reason", value: "Sonstiges", evidenceQuote: customerText, confidence: 0.95 }),
        proposal({
          field: "loss_reason_note",
          value: note,
          evidenceQuote: note,
          confidence: 0.6,
        }),
      ],
    });
    expect(mixed.decisions.filter((decision) => decision.action !== "drop").map((decision) => decision.action)).toEqual([
      "suggest",
      "suggest",
      "suggest",
    ]);
  });

  it("does not propose the same evidence again after a rejection", () => {
    const sample = proposal({ field: "source_channel", value: "WhatsApp" });
    const key = enrichmentEvidenceKey({
      field: "source_channel",
      evidenceSourceKind: "message",
      evidenceSourceId: "m1",
      evidenceQuote: sample.evidenceQuote,
    });
    const result = run({
      rejectedEvidenceKeys: new Set([key]),
      proposals: [sample],
    });
    expect(result.decisions[0]).toMatchObject({ reason: "rejected_evidence" });
  });

  it("follows the workspace switches", () => {
    const high = proposal({ field: "source_detail", value: "Kleinanzeigen Sofa", confidence: 0.96 });
    expect(run({ autoWriteEnabled: false, proposals: [high] }).decisions[0]).toMatchObject({ action: "suggest" });
    expect(
      run({ suggestionsEnabled: false, proposals: [{ ...high, confidence: 0.4 }] }).decisions[0]
    ).toMatchObject({ reason: "below_threshold" });
    expect(
      run({ suggestionsEnabled: false, autoWriteEnabled: false, proposals: [high] }).skipped?.reason
    ).toBe("kill_switch");
  });

  it("allows a free-text Anzeige only while that field is empty", () => {
    const result = run({
      proposals: [
        proposal({
          field: "source_detail",
          value: "Sofa | Stuttgart | Kottke",
          evidenceQuote: "ich komme über WhatsApp",
        }),
      ],
    });
    expect(result.decisions[0]).toMatchObject({
      action: "auto_write",
      value: "Sofa | Stuttgart | Kottke",
    });
  });
});

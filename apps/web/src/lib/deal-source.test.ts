import { describe, expect, it } from "vitest";
import { STANDARD_OBJECTS } from "@openclaw-crm/shared";
import {
  LOSS_REASON_OPTIONS,
  QUOTED_REASONS,
  SOURCE_CHANNEL_OPTIONS,
  classifyInboundDealSource,
  decideQuotedAdvance,
  extractKleinanzeigenDetail,
  isCustomerOfferMessage,
  isClosedSpeedToLeadStage,
  lossReasonProblem,
  operatingCompanyKey,
  sourceFromMovingLeadPayload,
  speedToLeadSla,
} from "./deal-source";

const stages = [
  { id: "inquiry", title: "Inquiry", sortOrder: 0, stageCategory: "open_new" },
  { id: "contacted", title: "Contacted", sortOrder: 1, stageCategory: "open_engaged" },
  { id: "quoted", title: "Quoted", sortOrder: 3, stageCategory: "quoted" },
  { id: "booked", title: "Planned", sortOrder: 4, stageCategory: "booked" },
  { id: "paid", title: "Paid", sortOrder: 6, stageCategory: "paid" },
  { id: "lost", title: "Lost", sortOrder: 7, stageCategory: "lost" },
];

describe("deal source options match the standard object", () => {
  const deals = STANDARD_OBJECTS.find((object) => object.slug === "deals");
  const source = deals?.attributes.find((attr) => attr.slug === "source_channel");
  const loss = deals?.attributes.find((attr) => attr.slug === "loss_reason");

  it("keeps Quelle off the people lead_source slug", () => {
    expect(deals?.attributes.some((attr) => attr.slug === "lead_source")).toBe(false);
    expect(source?.isRequired).toBe(false);
  });

  it("lists the approved Quelle and Verlustgrund titles", () => {
    expect(source?.selectOptions?.map((option) => option.title)).toEqual([...SOURCE_CHANNEL_OPTIONS]);
    expect(loss?.selectOptions?.map((option) => option.title)).toEqual([...LOSS_REASON_OPTIONS]);
  });
});

describe("classifyInboundDealSource", () => {
  it("stamps WhatsApp from the channel", () => {
    expect(classifyInboundDealSource({ channelType: "whatsapp" })).toBe("WhatsApp");
  });

  it("stamps Kleinanzeigen from the relay address", () => {
    expect(
      classifyInboundDealSource({
        fromEmail: "abc-0123456789abcdef0123456789abcdef01234567-ek-ek@mail.kleinanzeigen.de",
        subject: "Anfrage",
      })
    ).toBe("Kleinanzeigen");
  });

  it("maps ImmoScout and umzugsfirmen-check onto one option", () => {
    expect(classifyInboundDealSource({ payloadSource: "immoscout24" })).toBe(
      "ImmoScout24 / umzugsfirmen-check"
    );
    expect(classifyInboundDealSource({ payloadSource: "umzugsfirmen-check" })).toBe(
      "ImmoScout24 / umzugsfirmen-check"
    );
    expect(
      classifyInboundDealSource({
        fromEmail: "noreply@immobilienscout24.de",
        subject: "IS24 Umzugsanfrage: ID 1 / Ana",
      })
    ).toBe("ImmoScout24 / umzugsfirmen-check");
  });

  it("recognises a website form and a Google profile", () => {
    expect(classifyInboundDealSource({ payloadSource: "website-formular" })).toBe("Website-Formular");
    expect(classifyInboundDealSource({ subject: "Neue Anfrage über die Website", body: "Umzug" })).toBe(
      "Website-Formular"
    );
    expect(classifyInboundDealSource({ fromEmail: "business-messages-noreply@google.com", subject: "Hi" })).toBe(
      "Google-Profil (GBP)"
    );
  });

  it("leaves generic mail and mixed signals empty", () => {
    expect(classifyInboundDealSource({ fromEmail: "ada@example.com", subject: "Umzug", body: "Hallo" })).toBeNull();
    expect(
      classifyInboundDealSource({
        fromEmail: "abc-0123456789abcdef0123456789abcdef01234567-ek-ek@mail.kleinanzeigen.de",
        subject: "Kontaktformular Anfrage",
        payloadSource: "website",
      })
    ).toBeNull();
  });

  it("reads moving_lead_payload.source", () => {
    expect(sourceFromMovingLeadPayload({ source: "immoscout24" })).toBe("ImmoScout24 / umzugsfirmen-check");
    expect(sourceFromMovingLeadPayload({ source: "phone" })).toBeNull();
  });
});

describe("extractKleinanzeigenDetail", () => {
  it("prefers the bracket tag", () => {
    expect(extractKleinanzeigenDetail("[K1|Bogenhausen|Kottke] Möbeltransport", "Anzeigen-ID: 123456")).toBe(
      "K1|Bogenhausen|Kottke"
    );
  });

  it("falls back to a quoted title and ad id", () => {
    expect(extractKleinanzeigenDetail("Anfrage", 'Anzeige „Umzug München“ Anzeigen-ID: 998877')).toBe(
      "Umzug München (998877)"
    );
    expect(extractKleinanzeigenDetail("", "Ad-ID: 445566")).toBe("445566");
  });
});

describe("lossReasonProblem", () => {
  it("requires a reason only for the UI move to lost", () => {
    expect(lossReasonProblem({ enforce: true, movingToLost: true, reasonTitle: null, note: null })).toMatch(/Verlustgrund/);
    expect(lossReasonProblem({ enforce: false, movingToLost: true, reasonTitle: null, note: null })).toBeNull();
    expect(lossReasonProblem({ enforce: true, movingToLost: true, reasonTitle: "zu teuer", note: null })).toBeNull();
  });

  it("requires a note for Sonstiges even on the API", () => {
    expect(lossReasonProblem({ enforce: false, movingToLost: true, reasonTitle: "Sonstiges", note: "  " })).toMatch(
      /Freitext/
    );
  });
});

describe("decideQuotedAdvance", () => {
  it("never moves a deal onto a hidden stage", () => {
    const mitDubletten = [
      { id: "new", title: "Neue Anfrage", sortOrder: 0, isActive: true, stageCategory: "open_new" },
      { id: "quoted_en", title: "Quoted", sortOrder: 3, isActive: false, stageCategory: "quoted" },
    ];
    expect(decideQuotedAdvance({ stages: mitDubletten, currentStageId: "new" })).toBeNull();
    expect(
      decideQuotedAdvance({
        stages: [...mitDubletten, { id: "angebot", title: "Angebot", sortOrder: 2, isActive: true, stageCategory: "quoted" }],
        currentStageId: "new",
      })
    ).toBe("angebot");
  });

  it("moves an earlier stage forward and records the reason constants", () => {
    expect(decideQuotedAdvance({ stages, currentStageId: "inquiry" })).toBe("quoted");
    expect(decideQuotedAdvance({ stages, currentStageId: null })).toBe("quoted");
    expect(QUOTED_REASONS.kvDocument).toBe("Kostenvoranschlag gespeichert");
  });

  it("never moves backwards or out of won, paid, or lost", () => {
    expect(decideQuotedAdvance({ stages, currentStageId: "quoted" })).toBeNull();
    expect(decideQuotedAdvance({ stages, currentStageId: "booked" })).toBeNull();
    expect(decideQuotedAdvance({ stages, currentStageId: "paid" })).toBeNull();
    expect(decideQuotedAdvance({ stages, currentStageId: "lost" })).toBeNull();
    expect(
      decideQuotedAdvance({
        stages: [{ id: "won", title: "Gewonnen", sortOrder: 1, stageCategory: null }],
        currentStageId: "won",
      })
    ).toBeNull();
  });
});

describe("speed to lead", () => {
  it("bands age at 1 hour and 24 hours", () => {
    expect(speedToLeadSla(30 * 60 * 1000)).toBe("green");
    expect(speedToLeadSla(2 * 60 * 60 * 1000)).toBe("yellow");
    expect(speedToLeadSla(25 * 60 * 60 * 1000)).toBe("red");
  });

  it("treats terminal lost, paid, and done stages as closed", () => {
    expect(isClosedSpeedToLeadStage({ title: "Inquiry", stageCategory: "open_new" })).toBe(false);
    expect(isClosedSpeedToLeadStage({ title: "Quoted", stageCategory: "quoted" })).toBe(false);
    expect(isClosedSpeedToLeadStage({ title: "Lost", stageCategory: "lost", isTerminal: true })).toBe(true);
    expect(isClosedSpeedToLeadStage({ title: "Durchgeführt", stageCategory: "done_unpaid" })).toBe(true);
  });

  it("maps operating companies", () => {
    expect(operatingCompanyKey("Kottke Dienstleistungen")).toBe("kottke");
    expect(operatingCompanyKey("Ceylan Umzüge")).toBe("ceylan");
  });
});

describe("isCustomerOfferMessage", () => {
  it("accepts a sent KV portal message and rejects later documents", () => {
    expect(isCustomerOfferMessage("Ihr Kostenvoranschlag: https://portal.example/s/abc123")).toBe(true);
    expect(isCustomerOfferMessage("Auftragsbestätigung https://portal.example/s/abc123")).toBe(false);
    expect(isCustomerOfferMessage("Kostenvoranschlag ohne Link")).toBe(false);
  });
});

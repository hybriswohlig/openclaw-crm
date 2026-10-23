import { describe, expect, it } from "vitest";
import {
  eingangsLane,
  bucketNonLeadsByMonth,
  dealIsNonLead,
  isLeadKunde,
  normalizeKontaktart,
  stageMoveForKontaktart,
  summarizeLeadKpis,
  bewerberQuote,
} from "./kontaktart";

describe("Kontaktart", () => {
  it("accepts the slug and the German label", () => {
    expect(normalizeKontaktart("bewerber")).toBe("bewerber");
    expect(normalizeKontaktart("Team/Helfer")).toBe("team_helfer");
    expect(normalizeKontaktart("Spam/Werbung")).toBe("spam_werbung");
    expect(normalizeKontaktart("irgendwas")).toBeNull();
  });

  it("treats empty and lead_kunde as leads", () => {
    expect(isLeadKunde(null)).toBe(true);
    expect(isLeadKunde("")).toBe(true);
    expect(isLeadKunde("lead_kunde")).toBe(true);
    expect(isLeadKunde("Lead/Kunde")).toBe(true);
    expect(isLeadKunde("bewerber")).toBe(false);
  });
});

describe("lead KPI exclusion", () => {
  const deals = [
    { id: "a", kontaktart: "lead_kunde", stageCategory: "lost", stageTitle: "Verloren", value: 100 },
    { id: "b", kontaktart: "bewerber", stageCategory: "lost", stageTitle: "Verloren", value: 50 },
    { id: "c", kontaktart: "lead_kunde", stageCategory: "kein_lead", stageTitle: "Kein Lead", value: 20 },
    { id: "d", kontaktart: null, stageCategory: "paid", stageTitle: "Bezahlt", value: 400 },
    { id: "e", kontaktart: "spam_werbung", stageCategory: "open_new", stageTitle: "Neue Anfrage", value: 10 },
    { id: "f", kontaktart: "partner_vermittler", stageCategory: "open_engaged", stageTitle: "In Kontakt" },
  ];

  it("counts only lead_kunde and does not treat Kein Lead as a loss", () => {
    const summary = summarizeLeadKpis(deals);
    expect(summary.leadCount).toBe(2);
    expect(summary.lost).toBe(1);
    expect(summary.won).toBe(1);
    expect(summary.winRatePct).toBe(50);
    expect(summary.pipelineValue).toBe(500);
  });

  it("a non-lead signal on the person or the conversation excludes the deal", () => {
    expect(dealIsNonLead({ conversationKontaktarten: ["lead_kunde"], personKontaktarten: ["privat"] })).toBe(true);
    expect(dealIsNonLead({ conversationKontaktarten: ["team_helfer"] })).toBe(true);
    expect(dealIsNonLead({ conversationKontaktarten: [null], personKontaktarten: [] })).toBe(false);
    expect(dealIsNonLead({ stageTitle: "Kein Lead" })).toBe(true);
  });

  it("moves open and lost deals to Kein Lead and leaves paid deals alone", () => {
    expect(stageMoveForKontaktart({ kontaktart: "bewerber", stageCategory: "lost", stageTitle: "Verloren" })).toBe(
      "kein_lead"
    );
    expect(stageMoveForKontaktart({ kontaktart: "bewerber", stageCategory: "open_new" })).toBe("kein_lead");
    expect(stageMoveForKontaktart({ kontaktart: "privat", stageCategory: "paid", stageTitle: "Bezahlt" })).toBe("keep");
    expect(stageMoveForKontaktart({ kontaktart: "lead_kunde", stageCategory: "kein_lead", stageTitle: "Kein Lead" })).toBe(
      "restore_open"
    );
  });

  it("counts non-leads per Kontaktart per month", () => {
    const now = new Date("2026-10-15T12:00:00Z");
    const buckets = bucketNonLeadsByMonth(
      [
        { kontaktart: "bewerber", at: new Date("2026-10-02T00:00:00Z") },
        { kontaktart: "bewerber", at: new Date("2026-10-20T00:00:00Z") },
        { kontaktart: "lead_kunde", at: new Date("2026-10-03T00:00:00Z") },
        { kontaktart: "spam_werbung", at: new Date("2026-09-01T00:00:00Z") },
        { kontaktart: "privat", at: new Date("2025-01-01T00:00:00Z") },
      ],
      now
    );
    expect(buckets).toEqual([
      { month: "2026-09", kontaktart: "spam_werbung", label: "Spam/Werbung", count: 1 },
      { month: "2026-10", kontaktart: "bewerber", label: "Bewerber", count: 2 },
    ]);
  });
});

describe("bewerber detection", () => {
  it("quotes a job application from the message", () => {
    expect(bewerberQuote("Guten Tag, anbei meine Bewerbung als Möbelpacker.")).toBe("Bewerbung");
    expect(bewerberQuote("Wir möchten am 3. Mai umziehen.")).toBeNull();
  });
});

// Neuer Thread einer Person mit bekannter Kontaktart: Nur was die Triage als
// Anfrage einstuft, wandert nach kein_lead. Newsletter, Abwesenheitsnotiz und
// Spam bleiben in ihrer Lane.
describe("eingangsLane", () => {
  it("macht aus einer Anfrage eines Helfers kein_lead", () => {
    expect(eingangsLane("team_helfer", "lead")).toBe("kein_lead");
    expect(eingangsLane("spam_werbung", "lead")).toBe("kein_lead");
  });

  it("lässt info, spam und review stehen", () => {
    expect(eingangsLane("partner_vermittler", "info")).toBe("info");
    expect(eingangsLane("bewerber", "spam")).toBe("spam");
    expect(eingangsLane("privat", "review")).toBe("review");
  });

  it("ändert für Leads nichts", () => {
    expect(eingangsLane("lead_kunde", "lead")).toBe("lead");
    expect(eingangsLane("lead_kunde", "info")).toBe("info");
  });
});

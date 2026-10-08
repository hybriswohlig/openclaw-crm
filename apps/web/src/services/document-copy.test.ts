import { describe, expect, it } from "vitest";
import {
  applyDocumentCopy,
  attentionFromJobTitle,
  buildDocumentCopy,
  formatEinsatz,
  isHouseholdMove,
  looksLikeCompanyName,
  type DealDocumentSource,
} from "./document-copy";

const ACITO_NOTES = [
  "B2B Acito Logistics / Thomas Pokorny. McDonald's Freudenstadt, Stuttgarter Straße 193, 72250. Mi 14.10.2026 ab 08:00. Leistung: 4 Mann Abtragen und Einbringen der Geräte/Möbel in den Store; Außenverpackung entfernen und Verpackung auf den anliefernden LKW zurückladen. Keine Montage. Kein Haushaltsumzug. PSA Pflicht.",
  "",
  "Abrechnung variabel: 920 € für die ersten 4 Stunden inkl. Anfahrt und 4 Mann; danach 70 € je begonnene 30 Minuten (140 €/h).",
  "",
  "Zahlungsbedingungen (vereinbart): Anzahlung 200,00 € vor Auftragsbeginn per Überweisung (fällig bis spätestens 13.10.2026 / vor Einsatzbeginn). Der Restbetrag wird nach erfolgreichem Auftrag per Überweisung fällig — innerhalb von 1 Tag nach Auftragsschluss bzw. innerhalb von 7 Tagen nach Zugang der Schlussrechnung. Keine Bar-/Kartenzahlung vor Ort für den Rest.",
].join("\n");

function acitoSource(over: Partial<DealDocumentSource> = {}): DealDocumentSource {
  return {
    serviceType: "move",
    showStandardInclusions: false,
    summary:
      "4 Mann Freudenstadt McDonald's 14.10.2026: 920 € für 4 h inkl. Anfahrt; danach 140 €/h im 30-Min-Takt. Anzahlung 200 € vorab; Rest per Überweisung nach Auftrag.",
    notes: ACITO_NOTES,
    depositEur: 200,
    totalEur: 920,
    paidEur: 0,
    paymentMethod: "bank_transfer",
    lineItems: [
      {
        type: "other",
        description:
          "4 Mann inkl. Anfahrt — erste 4 Stunden (Abtragen, Einbringen Geräte/Möbel, Außenverpackung entfernen und auf LKW zurückladen; keine Montage)",
        quantity: 1,
        unitRate: 920,
      },
      {
        type: "other",
        description: "Jede weitere begonnene 30 Minuten nach den 4 Stunden (entspricht 140 €/h)",
        quantity: 0,
        unitRate: 70,
      },
    ],
    moveDate: "2026-10-14",
    toAddress: "Stuttgarter Straße 193, 72250 Freudenstadt",
    toCity: "Freudenstadt",
    inventoryNotes:
      "4 Mann Abtragen und Einbringen Edelstahl-Küchenmöbel/Geräte McDonald's Freudenstadt. Außenverpackung entfernen und auf anliefernden LKW zurückladen.",
    party: {
      fullName: "ACITO Logistics GmbH",
      vorname: "ACITO Logistics",
      nachname: "GmbH",
      jobTitle: "z. Hd. Thomas Pokorny · Disposition / Lademittel",
      addressLines: ["Rebgartenweg 23", "79576 Weil am Rhein"],
      email: "charter-de-ch@acito.eu",
    },
    ...over,
  };
}

const MOVE_BOILERPLATE = /Umzugsdienstleistung|Umzugsauftrag|vereinbarte Pauschale|Umzugstag|\bPauschale\b/;

describe("company and date helpers", () => {
  it("recognises a company legal form and a private name", () => {
    expect(looksLikeCompanyName("ACITO Logistics GmbH")).toBe(true);
    expect(looksLikeCompanyName("ACITO Logistics")).toBe(false);
    expect(looksLikeCompanyName("Kyra Hiker")).toBe(false);
  });

  it("reads z. Hd. out of a job title", () => {
    expect(attentionFromJobTitle("z. Hd. Thomas Pokorny · Disposition / Lademittel")).toBe(
      "Thomas Pokorny"
    );
    expect(attentionFromJobTitle("Disposition")).toBeNull();
  });

  it("formats the Wednesday of the ACITO job", () => {
    expect(formatEinsatz("2026-10-14")).toBe("Mi 14.10.2026");
  });
});

describe("deal 274a6463 deposit invoice (ACITO)", () => {
  const note = "Hinweis zur PSA: Sicherheitsschuhe und Warnwesten. ".repeat(40).trim();

  it("builds a 200 € deposit invoice without move or Pauschale wording", () => {
    const params = applyDocumentCopy(
      {
        firma: "kottke",
        document_type: "RE",
        invoice_kind: "deposit",
        service_type: "move",
        kunde: { vorname: "ACITO Logistics", nachname: "GmbH" },
        anweisung: note,
      },
      acitoSource()
    );
    const copy = params.document_copy as ReturnType<typeof buildDocumentCopy>;

    expect(copy.legacy_move_wording).toBe(false);
    expect(copy.invoice_kind).toBe("deposit");
    expect(copy.document_title).toBe("RECHNUNG — Anzahlung");
    expect(copy.recipient_kind).toBe("company");
    expect(copy.company_name).toBe("ACITO Logistics GmbH");
    expect(copy.salutation).toBe("Sehr geehrte Damen und Herren");
    expect(copy.attention).toBe("Thomas Pokorny");
    expect(copy.recipient_lines).toEqual([
      "ACITO Logistics GmbH",
      "z. Hd. Thomas Pokorny",
      "Rebgartenweg 23",
      "79576 Weil am Rhein",
    ]);
    expect(copy.amount_eur).toBe(200);
    expect(copy.due_date).toBe("2026-10-13");
    expect(copy.due_date_label).toBe("13.10.2026 (vor Einsatz)");
    expect(copy.service_date).toBe("2026-10-14");
    expect(copy.show_card_payment).toBe(false);
    expect(copy.omit_service_day_thanks).toBe(true);
    expect(copy.closing).toBeNull();
    expect(copy.line_item_title).toBe("Anzahlung vor Auftragsbeginn");
    expect(copy.intro).toContain("vereinbarte Anzahlung von 200,00 € vor Auftragsbeginn");
    expect(copy.line_item_description).toMatch(/Abtragen/);
    expect(copy.line_item_description).toMatch(/Einbringen/);
    expect(copy.line_item_description).toMatch(/Verpackung|Außenverpackung/);
    expect(copy.line_item_description).toContain("Einsatz: Mi 14.10.2026");
    expect(copy.payment_terms).toContain("überweisen");
    expect(copy.payment_terms).toContain("13.10.2026 (vor Einsatzbeginn)");
    expect(copy.payment_terms).toContain("DE81 1001 8000 0379 5948 02");
    expect(copy.payment_terms).toContain("Darioush Kottke");
    expect(copy.payment_terms).toContain("Restbetrag");
    expect(copy.payment_terms).toContain("Keine Bar-/Kartenzahlung vor Ort");
    expect(copy.payment_terms).not.toContain("Kartenzahlung direkt vor Ort");
    expect(copy.gesamthinweis).toContain("Abrechnung variabel");
    expect(copy.gesamthinweis).toContain("920 €");
    expect(copy.hinweis).toBe(note);
    expect(copy.hinweis?.length).toBeGreaterThan(500);

    const spoken = [
      copy.document_title,
      copy.subtitle,
      copy.intro,
      copy.line_item_title,
      copy.line_item_description,
      copy.closing,
    ].join("\n");
    expect(spoken).not.toMatch(MOVE_BOILERPLATE);

    const kunde = params.kunde as Record<string, string>;
    expect(kunde.anrede).toBe("Sehr geehrte Damen und Herren");
    expect(kunde.firma).toBe("ACITO Logistics GmbH");
    expect(kunde.nachname).toBe("ACITO Logistics GmbH");
    expect(kunde.zu_haenden).toBe("Thomas Pokorny");
    expect(kunde.email).toBe("charter-de-ch@acito.eu");
    expect(kunde.adresse).toContain("Rebgartenweg 23");
    expect(kunde.adresse).toContain("z. Hd. Thomas Pokorny");

    const preise = params.preise as {
      rechnungsbetrag_eur: number;
      pauschale_positionen: Array<{ titel: string; betrag: number; beschreibung: string }>;
    };
    expect(preise.rechnungsbetrag_eur).toBe(200);
    expect(preise.pauschale_positionen).toEqual([
      expect.objectContaining({
        titel: "Anzahlung vor Auftragsbeginn",
        betrag: 200,
      }),
    ]);
    expect(preise.pauschale_positionen[0].beschreibung?.length).toBeGreaterThan(80);
    expect(params.anweisung).toBe(note);
  });

  it("lets an explicit title, due date and payment text win", () => {
    const terms = "Nur Überweisung, keine Karte. ".repeat(30).trim();
    const params = applyDocumentCopy(
      {
        firma: "kottke",
        document_type: "RE",
        invoice_kind: "deposit",
        due_date: "2026-10-12",
        due_date_note: "vor Einsatz",
        payment_terms: terms,
        document_details: {
          leistungstitel: "Abtragen / Einbringen Geräte & Möbel · McDonald’s Freudenstadt · 14.10.2026",
          leistungsbeschreibung:
            "4 Mann Abtragen und Einbringen der Geräte/Möbel in den Store McDonald's Freudenstadt.",
        },
        kunde: { anrede: "Sehr geehrter Herr Pokorny", zu_haenden: "Thomas Pokorny", nachname: "GmbH" },
      },
      acitoSource()
    );
    const copy = params.document_copy as ReturnType<typeof buildDocumentCopy>;
    expect(copy.subtitle).toBe(
      "Abtragen / Einbringen Geräte & Möbel · McDonald’s Freudenstadt · 14.10.2026"
    );
    expect(copy.due_date).toBe("2026-10-12");
    expect(copy.payment_terms).toBe(terms);
    expect(copy.salutation).toBe("Sehr geehrter Herr Pokorny");
    expect(copy.line_item_description).toContain("Abtragen und Einbringen");
  });
});

describe("backward compatible household moves", () => {
  const source: DealDocumentSource = {
    serviceType: "move",
    showStandardInclusions: true,
    summary: "3-Zimmer-Umzug Freudenstadt nach Stuttgart",
    notes: null,
    depositEur: null,
    totalEur: 890,
    paidEur: 0,
    paymentMethod: "bank_transfer",
    lineItems: [],
    moveDate: "2026-08-01",
    party: { fullName: "Kyra Hiker", vorname: "Kyra", nachname: "Hiker" },
  };

  it("leaves title, intro and the Pauschale line untouched when the new params are omitted", () => {
    const params = applyDocumentCopy(
      {
        firma: "kottke",
        document_type: "RE",
        service_type: "move",
        kunde: { vorname: "Kyra", nachname: "Hiker", adresse: "Hauptstr. 1" },
        auftrag: { datum: "2026-08-01", strecke_von: "A", strecke_nach: "B" },
        preise: { modell: "pauschale", pauschale_positionen: [{ titel: "Pauschale", betrag: 890 }] },
      },
      source
    );
    const copy = params.document_copy as ReturnType<typeof buildDocumentCopy>;
    expect(isHouseholdMove(source)).toBe(true);
    expect(copy.legacy_move_wording).toBe(true);
    expect(copy.invoice_kind).toBeNull();
    expect(copy.document_title).toBeNull();
    expect(copy.intro).toBeNull();
    expect(copy.subtitle).toBeNull();
    expect(copy.closing).toBeNull();
    expect(copy.line_item_title).toBeNull();
    expect(copy.payment_terms).toBeNull();
    expect(copy.salutation).toBeNull();
    expect(copy.show_card_payment).toBe(false);
    expect(copy.omit_service_day_thanks).toBe(false);
    expect(params.preise).toEqual({
      modell: "pauschale",
      pauschale_positionen: [{ titel: "Pauschale", betrag: 890 }],
    });
    expect((params.kunde as { nachname: string }).nachname).toBe("Hiker");
    expect(params.invoice_kind).toBeUndefined();
  });

  it("still addresses a company that booked a real move as Damen und Herren", () => {
    const params = applyDocumentCopy(
      {
        firma: "kottke",
        document_type: "AB",
        service_type: "move",
        kunde: { vorname: "Nord", nachname: "GmbH" },
      },
      {
        ...source,
        party: { fullName: "Nord GmbH", vorname: "Nord", nachname: "GmbH" },
      }
    );
    const copy = params.document_copy as ReturnType<typeof buildDocumentCopy>;
    expect(copy.legacy_move_wording).toBe(true);
    expect(copy.document_title).toBeNull();
    expect(copy.salutation).toBe("Sehr geehrte Damen und Herren");
    expect((params.kunde as { nachname: string }).nachname).toBe("Nord GmbH");
  });

  it("uses deposit wording on a real move without calling the whole job a Pauschale", () => {
    const params = applyDocumentCopy(
      { firma: "kottke", document_type: "RE", invoice_kind: "deposit", due_date: "2026-07-31" },
      { ...source, depositEur: 200 }
    );
    const copy = params.document_copy as ReturnType<typeof buildDocumentCopy>;
    expect(copy.legacy_move_wording).toBe(false);
    expect(copy.document_title).toBe("RECHNUNG — Anzahlung");
    expect(copy.intro).toContain("vor Auftragsbeginn");
    expect(copy.intro).not.toMatch(/Pauschale|Umzugsauftrag/);
    expect(copy.omit_service_day_thanks).toBe(true);
    expect(copy.due_date).toBe("2026-07-31");
    expect(copy.due_date_label).toBe("31.07.2026 (vor Einsatz)");
    expect(copy.amount_eur).toBe(200);
  });
});

describe("AB, KV, final invoices and card payment", () => {
  it("gives a non-move KV and AB a service title and no card sentence", () => {
    for (const documentType of ["KV", "AB"] as const) {
      const params = applyDocumentCopy(
        { firma: "kottke", document_type: documentType, kunde: { nachname: "GmbH", vorname: "ACITO Logistics" } },
        acitoSource()
      );
      const copy = params.document_copy as ReturnType<typeof buildDocumentCopy>;
      expect(copy.legacy_move_wording).toBe(false);
      expect(copy.document_title).toBe(documentType === "KV" ? "KOSTENVORANSCHLAG" : "AUFTRAGSBESTÄTIGUNG");
      expect(copy.salutation).toBe("Sehr geehrte Damen und Herren");
      expect(copy.show_card_payment).toBe(false);
      expect(`${copy.document_title}\n${copy.intro}\n${copy.subtitle}`).not.toMatch(
        /Umzugsdienstleistung|Pauschale/
      );
      expect(copy.payment_terms).toContain("Anzahlung");
      expect(copy.payment_terms).not.toContain("Kartenzahlung direkt vor Ort");
    }
  });

  it("deducts a paid deposit on a final invoice", () => {
    const params = applyDocumentCopy(
      {
        firma: "kottke",
        document_type: "RE",
        invoice_kind: "final",
        preise: { modell: "pauschale", pauschale_positionen: [{ titel: "Tragen", betrag: 920 }] },
      },
      acitoSource({ paidEur: 200 })
    );
    const copy = params.document_copy as ReturnType<typeof buildDocumentCopy>;
    expect(copy.amount_eur).toBe(720);
    expect(copy.deposit_deducted_eur).toBe(200);
    expect(copy.intro).toContain("200,00 €");
    expect(copy.intro).toContain("abgezogen");
    expect(copy.closing).toBeNull();
    expect(copy.omit_service_day_thanks).toBe(true);
    const preise = params.preise as {
      rechnungsbetrag_eur: number;
      abzuege: Array<{ titel: string; betrag: number }>;
      pauschale_positionen: Array<{ titel: string; betrag: number }>;
    };
    expect(preise.rechnungsbetrag_eur).toBe(720);
    expect(preise.abzuege).toEqual([{ titel: "Abzüglich Anzahlung", betrag: 200 }]);
    expect(preise.pauschale_positionen.map((row) => row.betrag)).toEqual([920, -200]);
  });

  it("mentions card payment only when card is the chosen method", () => {
    const card = applyDocumentCopy(
      { firma: "kottke", document_type: "RE", invoice_kind: "final" },
      acitoSource({ paymentMethod: "card", paidEur: 0 })
    );
    const copy = card.document_copy as ReturnType<typeof buildDocumentCopy>;
    expect(copy.show_card_payment).toBe(true);
    expect(copy.payment_terms).toBe("Kartenzahlung direkt vor Ort ist vereinbart.");

    const transfer = applyDocumentCopy(
      { firma: "kottke", document_type: "RE", invoice_kind: "final" },
      acitoSource({ paymentMethod: "bank_transfer", paidEur: 0 })
    );
    const transferCopy = transfer.document_copy as ReturnType<typeof buildDocumentCopy>;
    expect(transferCopy.show_card_payment).toBe(false);
    expect(transferCopy.payment_terms).not.toContain("Kartenzahlung direkt vor Ort");
  });

  it("keeps a kitchen KV on its existing template branch", () => {
    const params = applyDocumentCopy(
      { firma: "kottke", document_type: "KV", service_type: "kitchen_installation" },
      {
        serviceType: "kitchen_installation",
        showStandardInclusions: true,
        paymentMethod: "bank_transfer",
        summary: "Küchenmontage Stuttgart",
        party: { fullName: "Kyra Hiker", vorname: "Kyra", nachname: "Hiker" },
      }
    );
    const copy = params.document_copy as ReturnType<typeof buildDocumentCopy>;
    expect(copy.legacy_move_wording).toBe(true);
    expect(copy.document_title).toBeNull();
    expect(copy.intro).toBeNull();
  });

  it("keeps a household-move KV on the legacy wording", () => {
    const params = applyDocumentCopy(
      {
        firma: "kottke",
        document_type: "KV",
        service_type: "move",
        preise: { modell: "pauschale", pauschale_positionen: [{ titel: "Pauschale", betrag: 890 }] },
      },
      {
        serviceType: "move",
        showStandardInclusions: true,
        paymentMethod: "cash",
        totalEur: 890,
        party: { fullName: "Kyra Hiker", vorname: "Kyra", nachname: "Hiker" },
      }
    );
    const copy = params.document_copy as ReturnType<typeof buildDocumentCopy>;
    expect(copy.legacy_move_wording).toBe(true);
    expect(copy.document_title).toBeNull();
    expect(copy.payment_terms).toBeNull();
    expect((params.preise as { pauschale_positionen: Array<{ titel: string }> }).pauschale_positionen[0].titel).toBe(
      "Pauschale"
    );
  });
});

import { describe, expect, it } from "vitest";
import { vorbelegungAusAngebot, vpsPreise, vpsPreiseMitStunden, VpsStundenError, type Angebot } from "./angebot-vorbelegung";

function festpreis(teil: Partial<Angebot> = {}): Angebot {
  return { fixedPrice: "2480.00", isVariable: false, lineItems: [], ...teil };
}

function stunden(teil: Partial<Angebot> = {}): Angebot {
  return {
    fixedPrice: null,
    isVariable: true,
    lineItems: [
      { type: "helper", quantity: 3, unitRate: "35.00" },
      { type: "helper", quantity: 1, unitRate: "40.00" },
      { type: "transporter", quantity: 1, unitRate: "25.00" },
      { type: "other", quantity: 1, unitRate: "99.00" },
    ],
    ...teil,
  };
}

describe("vorbelegungAusAngebot", () => {
  it("ohne Angebot nichts", () => {
    expect(vorbelegungAusAngebot(null, "kottke")).toBeUndefined();
  });

  it("Festpreis: Kottke als Pauschalposition, Ceylan als Pauschalbetrag", () => {
    expect(vorbelegungAusAngebot(festpreis(), "kottke")).toEqual({
      modell: "pauschale",
      pauschalePositionen: [{ titel: "Umzug pauschal", betrag: 2480 }],
    });
    expect(vorbelegungAusAngebot(festpreis(), "ceylan")).toEqual({
      modell: "pauschale",
      pauschaleBetragCeylan: 2480,
    });
  });

  it("Anzahlung: Betrag in Euro und Zahlungsweg (Überweisung, PayPal, sonst bar)", () => {
    expect(vorbelegungAusAngebot(festpreis({ depositRequiredCents: 50000, paymentMethodPreference: "bank_transfer" }), "kottke")).toMatchObject({
      anzahlungBar: 500,
      anzahlungMethod: "bank_transfer",
    });
    expect(vorbelegungAusAngebot(festpreis({ depositRequiredCents: 50000, paymentMethodPreference: "paypal" }), "kottke")).toMatchObject({
      anzahlungMethod: "paypal",
    });
    expect(vorbelegungAusAngebot(festpreis({ depositRequiredCents: 50000, paymentMethodPreference: "cash" }), "kottke")).toMatchObject({
      anzahlungMethod: "bar",
    });
    expect(vorbelegungAusAngebot(festpreis({ depositRequiredCents: 50000, paymentMethodPreference: null }), "kottke")).toMatchObject({
      anzahlungMethod: "bar",
    });
    // Keine oder leere Anzahlung: kein Anzahlungsfeld.
    expect(vorbelegungAusAngebot(festpreis({ depositRequiredCents: 0 }), "kottke")).not.toHaveProperty("anzahlungBar");
  });

  it("Stunden-KV: Helfer summiert, Sätze aus der ersten Position", () => {
    expect(vorbelegungAusAngebot(stunden(), "kottke")).toEqual({
      modell: "stundensatz",
      helferAnzahl: 4,
      helferRate: 35,
      transporterRate: 25,
    });
  });

  it("Stunden-KV ohne Transporter und mit Satz 0: Feld entfällt", () => {
    expect(
      vorbelegungAusAngebot(stunden({ lineItems: [{ type: "helper", quantity: 2, unitRate: "0" }] }), "kottke")
    ).toEqual({ modell: "stundensatz", helferAnzahl: 2, helferRate: undefined });
  });

  it("Stunden-KV ohne Positionen: nur die Anzahlung, sonst nichts", () => {
    expect(vorbelegungAusAngebot(stunden({ lineItems: [] }), "kottke")).toBeUndefined();
    expect(vorbelegungAusAngebot(stunden({ lineItems: [], depositRequiredCents: 30000 }), "ceylan")).toEqual({
      anzahlungBar: 300,
      anzahlungMethod: "bar",
    });
  });

  it("Festpreis 0 oder fehlend ohne Positionen: nichts", () => {
    expect(vorbelegungAusAngebot(festpreis({ fixedPrice: "0" }), "kottke")).toBeUndefined();
    expect(vorbelegungAusAngebot(festpreis({ fixedPrice: null }), "ceylan")).toBeUndefined();
  });
});

describe("vorbelegungAusAngebot: Quotation aus einer gesperrten Version (Plan 5a)", () => {
  const posten: Angebot["lineItems"] = [
    { type: "other", description: "Umzug mit Team und Fahrzeug", quantity: 1, unitRate: "1500.00" },
    { type: "other", description: "Halteverbotszone", quantity: 2, unitRate: "110.00" },
  ];

  it("trägt die Posten der Version genau wie der VPS-Preisblock", () => {
    const q = festpreis({ fixedPrice: "1720.00", lineItems: posten, calculationVersionId: "ver_3" });
    const p = vorbelegungAusAngebot(q, "kottke");
    expect(p?.ausVersion).toEqual({ versionId: "ver_3", preise: vpsPreise("kottke", q) });
    expect(p?.ausVersion?.preise).toEqual({
      modell: "pauschale",
      pauschale_positionen: [
        { titel: "Umzug mit Team und Fahrzeug", betrag: 1500 },
        { titel: "Halteverbotszone", betrag: 220 },
      ],
    });
  });

  it("ohne Version kein Schreibschutz (Altbestand)", () => {
    expect(vorbelegungAusAngebot(festpreis({ lineItems: posten }), "kottke")?.ausVersion).toBeUndefined();
    expect(vorbelegungAusAngebot(festpreis({ calculationVersionId: null }), "kottke")?.ausVersion).toBeUndefined();
  });
});

describe("vorbelegungAusAngebot: Stunden-KV aus der Version (Plan 5b, K1)", () => {
  const stunden = {
    helfer: 3, transporter: 1, stundenGeschaetzt: 7.5, mindestStunden: 3, satzHelferEur: 35, satzTransporterEur: 25,
    summeGeschaetztCent: 97_500, mindestbetragCent: 39_000, quelle: "version",
  };
  const angebot = (transporter: number): Angebot => ({
    fixedPrice: null,
    isVariable: true,
    lineItems: [
      { type: "helper", description: "Helfer", quantity: 3, unitRate: "35.00" },
      { type: "transporter", description: "Transporter", quantity: transporter, unitRate: "25.00" },
    ],
    calculationVersionId: "ver_4",
    documentDetails: { stunden: { ...stunden, transporter } },
  });

  it("zeigt im Dialog die Stunden der Version, nicht die Transporter-Menge", () => {
    expect(vorbelegungAusAngebot(angebot(1), "kottke")?.ausVersion?.preise).toEqual({
      modell: "stundensatz",
      helfer_anzahl: 3,
      stunden_geschaetzt: 7.5,
      mindest_stunden: 3,
      stundensatz_helfer_eur: 35,
      stundensatz_transporter_eur: 25,
    });
  });

  it("zwei Transporter: keine Versionspreise im Dialog, der VPS-Weg lehnt ab", () => {
    expect(vorbelegungAusAngebot(angebot(2), "kottke")?.ausVersion).toBeUndefined();
    expect(() => vpsPreiseMitStunden("kottke", angebot(2))).toThrow(VpsStundenError);
  });
});

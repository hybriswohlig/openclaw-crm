import { describe, expect, it, vi } from "vitest";

const jobMocks = vi.hoisted(() => ({ getQuotation: vi.fn(), zeilen: new Map<unknown, unknown[]>() }));

// Kette für attachDocumentJobContext: der Deal gehört zum Workspace; sonst die
// Zeilen aus `jobMocks.zeilen` je Tabelle (z. B. kva_confirmations für die AB), leer ohne Eintrag.
vi.mock("@/db", async () => {
  const { records } = await import("@/db/schema/records");
  const kette = (): unknown => {
    let tabelle: unknown = null;
    const k: Record<string, unknown> = {};
    for (const f of ["from", "innerJoin", "where", "limit", "orderBy", "set"]) {
      k[f] = (t: unknown) => {
        if (f === "from") tabelle = t;
        return k;
      };
    }
    k.then = (ok: (v: unknown) => unknown, fehler: (e: unknown) => unknown) =>
      Promise.resolve(tabelle === records ? [{ id: "deal_1" }] : jobMocks.zeilen.get(tabelle) ?? []).then(ok, fehler);
    return k;
  };
  return { db: { select: () => kette(), update: () => kette() } };
});
vi.mock("@/services/quotations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/quotations")>()),
  getQuotation: jobMocks.getQuotation,
}));

import { attachDocumentJobContext, preiseFromQuotation } from "./document-job-context";
import { VpsStundenError } from "@/lib/angebot-vorbelegung";
import { kvaConfirmations } from "@/db/schema/customer-portal";
import { festpreisAlsPauschale } from "@/lib/festpreis-posten";
import { angebotsUebernahme } from "./rechner/uebernahme";
import type { RechnerErgebnis } from "./rechner/client";

/** Posten wie nach „In Angebot übernehmen“ (Kern + Hebel, Summe 1720 €) */
const kernUndHebel = [
  { type: "other", description: "Umzug mit Team und Fahrzeug", quantity: 1, unitRate: "1500.00" },
  { type: "other", description: "Halteverbotszone", quantity: 2, unitRate: "110.00" },
];

describe("preiseFromQuotation", () => {
  it("nimmt beim Festpreis die Posten, wenn ihre Summe der Festpreis ist", () => {
    expect(preiseFromQuotation("kottke", { isVariable: false, fixedPrice: "1720.00", lineItems: kernUndHebel })).toEqual({
      modell: "pauschale",
      pauschale_positionen: [
        { titel: "Umzug mit Team und Fahrzeug", betrag: 1500 },
        { titel: "Halteverbotszone", betrag: 220 },
      ],
    });
  });

  it("behält die Aufschlüsselung direkt nach „In Angebot übernehmen“", () => {
    const ergebnis: RechnerErgebnis = {
      preis: { festpreis: 1730, selbstkosten: 1100, rundungEur: 10, posten: [{ bezeichnung: "Halteverbotszone", menge: 2, einheit: "Stück", satz: 150, betrag: 300 }] },
      kosten: { selbstkosten: 1100, posten: [{ bezeichnung: "Halteverbotszone", menge: 2, einheit: "Stück", satz: 120, betrag: 240 }] },
      zeiten: { demontage: 84, montage: 114 },
      team: { groesse: 4 },
      positionen: [{ name: "Boxspringbett", menge: 1, volumenCbm: 2, zerlegt: true }],
      schaetzung: null,
    };
    const anfrage = { von_halteverbot: "on", nach_halteverbot: "on", umzugsdatum: "2026-10-20" };
    const r = angebotsUebernahme({ result: ergebnis, request: anfrage }, null, { jetzt: new Date("2026-10-08T10:00:00Z") });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.eingabe.lineItems.length).toBeGreaterThan(1);
    const preise = preiseFromQuotation("kottke", r.eingabe);
    expect(preise?.pauschale_positionen?.map((p) => p.titel)).toEqual(r.eingabe.lineItems.map((li) => li.description));
  });

  it("fällt auf eine Pauschale zurück, wenn die Posten nicht zum Festpreis passen", () => {
    expect(preiseFromQuotation("kottke", { isVariable: false, fixedPrice: "1800.00", lineItems: kernUndHebel })).toEqual({
      modell: "pauschale",
      pauschale_positionen: [{ titel: "Pauschale", betrag: 1800 }],
    });
  });

  it("rechnet die Summe in Cent und übergeht Posten ohne Preis", () => {
    const posten = [
      { type: "other", description: "Kern", quantity: 3, unitRate: "33.33" },
      { type: "other", description: "Möbelschutz inklusive", quantity: 1, unitRate: "0" },
    ];
    const preise = preiseFromQuotation("kottke", { isVariable: false, fixedPrice: "99.99", lineItems: posten });
    expect(preise?.pauschale_positionen).toHaveLength(1);
    expect(preise?.pauschale_positionen?.[0].titel).toBe("Kern");
  });

  it("zeigt beim Festpreis ohne Posten eine Pauschale", () => {
    expect(preiseFromQuotation("kottke", { isVariable: false, fixedPrice: "890", lineItems: [] })).toEqual({
      modell: "pauschale",
      pauschale_positionen: [{ titel: "Pauschale", betrag: 890 }],
    });
  });

  it("lässt den Stundensatz unverändert", () => {
    expect(
      preiseFromQuotation("kottke", {
        isVariable: true,
        fixedPrice: null,
        lineItems: [
          { type: "helper", description: "Helfer", quantity: 3, unitRate: "45" },
          { type: "transporter", description: "Transporter", quantity: 4, unitRate: "30" },
        ],
      })
    ).toEqual({
      modell: "stundensatz",
      helfer_anzahl: 3,
      stunden_geschaetzt: 4,
      mindest_stunden: 4,
      stundensatz_helfer_eur: 45,
      stundensatz_transporter_eur: 30,
    });
    // Stundensatz ohne Helfer und Transporter: Posten wie bisher, ohne Festpreisprüfung
    expect(
      preiseFromQuotation("kottke", {
        isVariable: true,
        fixedPrice: null,
        lineItems: [{ type: "other", description: "Klaviertransport", quantity: 1, unitRate: "300" }],
      })
    ).toEqual({ modell: "pauschale", pauschale_positionen: [{ titel: "Klaviertransport", betrag: 300 }] });
  });

  it("gibt Ceylan beim Festpreis weiter nur den Betrag", () => {
    expect(preiseFromQuotation("ceylan", { isVariable: false, fixedPrice: "1720.00", lineItems: kernUndHebel })).toEqual({
      modell: "pauschale",
      pauschale_betrag: 1720,
    });
  });

  const stundenPosten = [
    { type: "helper" as const, description: "Helfer", quantity: 3, unitRate: "35" },
    { type: "transporter" as const, description: "Transporter", quantity: 2, unitRate: "25" },
  ];
  const stunden = {
    helfer: 3,
    transporter: 1,
    stundenGeschaetzt: 7.5,
    mindestStunden: 3,
    satzHelferEur: 35,
    satzTransporterEur: 25,
    // (3 × 35 + 25) × 7,5 = 975 €; × 3 = 390 €
    summeGeschaetztCent: 97_500,
    mindestbetragCent: 39_000,
    quelle: "version" as const,
  };
  type Posten = { type: "helper" | "transporter" | "other"; description: string; quantity: number; unitRate: string };
  const einTransporter: Posten[] = [
    { type: "helper", description: "Helfer", quantity: 3, unitRate: "35" },
    { type: "transporter", description: "Transporter", quantity: 1, unitRate: "25" },
  ];
  const ausVersion = (s: typeof stunden, lineItems: Posten[] = einTransporter) => ({
    isVariable: true,
    fixedPrice: null,
    lineItems,
    calculationVersionId: "ver_1",
    documentDetails: { stunden: s },
  });

  it("ohne documentDetails.stunden bleiben geschätzte Stunden die Transporter-Menge", () => {
    expect(preiseFromQuotation("kottke", { isVariable: true, fixedPrice: null, lineItems: stundenPosten })).toEqual({
      modell: "stundensatz",
      helfer_anzahl: 3,
      stunden_geschaetzt: 2,
      mindest_stunden: 2,
      stundensatz_helfer_eur: 35,
      stundensatz_transporter_eur: 25,
    });
  });

  it("ein Transporter: alle Werte aus documentDetails.stunden", () => {
    expect(preiseFromQuotation("kottke", ausVersion(stunden))).toEqual({
      modell: "stundensatz",
      helfer_anzahl: 3,
      stunden_geschaetzt: 7.5,
      mindest_stunden: 3,
      stundensatz_helfer_eur: 35,
      stundensatz_transporter_eur: 25,
    });
  });

  // K1: der VPS-Block kennt keine Zahl der Transporter, er druckt den Satz für einen.
  it.each([0, 2, 3])("%i Transporter: Fehler statt falschem PDF", (transporter) => {
    const posten = [einTransporter[0], { ...einTransporter[1], quantity: transporter }];
    expect(() => preiseFromQuotation("kottke", ausVersion({ ...stunden, transporter }, posten))).toThrow(VpsStundenError);
    expect(() => preiseFromQuotation("kottke", ausVersion({ ...stunden, transporter }, posten))).toThrow(
      new RegExp(`nur mit genau einem Transporter, dieses Angebot hat ${transporter}\\.`)
    );
  });

  it("feste Zusatzposten: Fehler, der VPS-Block kennt sie nicht (F12)", () => {
    const posten: Posten[] = [...einTransporter, { type: "other", description: "Halteverbot", quantity: 1, unitRate: "150" }];
    expect(() => preiseFromQuotation("kottke", ausVersion(stunden, posten))).toThrow(/ohne feste Zusatzposten/);
  });

  it("ohne Version (von Hand gelöst) gilt documentDetails.stunden nicht mehr (I5)", () => {
    expect(preiseFromQuotation("kottke", { ...ausVersion({ ...stunden, transporter: 2 }), calculationVersionId: null })).toEqual({
      modell: "stundensatz",
      helfer_anzahl: 3,
      stunden_geschaetzt: 1,
      mindest_stunden: 1,
      stundensatz_helfer_eur: 35,
      stundensatz_transporter_eur: 25,
    });
  });

  it("lässt einen Festpreis unverändert, auch wenn Stunden am Dokument stehen", () => {
    expect(
      preiseFromQuotation("kottke", {
        isVariable: false,
        fixedPrice: "1720.00",
        lineItems: kernUndHebel,
        documentDetails: { stunden },
      })
    ).toEqual({
      modell: "pauschale",
      pauschale_positionen: [
        { titel: "Umzug mit Team und Fahrzeug", betrag: 1500 },
        { titel: "Halteverbotszone", betrag: 220 },
      ],
    });
  });
});

describe("Hinweis „Pauschale“ im KV-Fenster und KV", () => {
  // loadKvHinweise setzt den Hinweis mit festpreisAlsPauschale. Er muss genau
  // dann kommen, wenn der KV die eine Zeile „Pauschale“ druckt, sonst sagt das
  // Fenster etwas anderes, als im Dokument steht.
  type Quelle = Parameters<typeof preiseFromQuotation>[1];
  const faelle: Array<{ fall: string; q: Quelle; pauschale: boolean }> = [
    { fall: "Festpreis ohne Posten", q: { isVariable: false, fixedPrice: "890", lineItems: [] }, pauschale: true },
    {
      fall: "Festpreis mit passenden Posten",
      q: { isVariable: false, fixedPrice: "1720.00", lineItems: kernUndHebel },
      pauschale: false,
    },
    {
      fall: "Festpreis mit Posten eines älteren Stands",
      q: { isVariable: false, fixedPrice: "1800.00", lineItems: kernUndHebel },
      pauschale: true,
    },
    {
      fall: "Festpreis mit Posten ohne Preis",
      q: {
        isVariable: false,
        fixedPrice: "890",
        lineItems: [{ type: "other", description: "Möbelschutz inklusive", quantity: 1, unitRate: "0" }],
      },
      pauschale: true,
    },
    {
      fall: "Stundensatz mit gespeichertem Festpreis",
      q: {
        isVariable: true,
        fixedPrice: "500.00",
        lineItems: [
          { type: "helper", description: "Helfer", quantity: 3, unitRate: "45" },
          { type: "transporter", description: "Transporter", quantity: 4, unitRate: "30" },
        ],
      },
      pauschale: false,
    },
    {
      fall: "variabel ohne Helfer und Transporter",
      q: {
        isVariable: true,
        fixedPrice: "500.00",
        lineItems: [{ type: "other", description: "Klaviertransport", quantity: 1, unitRate: "300" }],
      },
      pauschale: false,
    },
    { fall: "variabel ohne Posten", q: { isVariable: true, fixedPrice: "500.00", lineItems: [] }, pauschale: true },
    { fall: "ohne Festpreis", q: { isVariable: false, fixedPrice: null, lineItems: kernUndHebel }, pauschale: false },
  ];

  /** Druckt der KV (Kottke) den Festpreis als die eine Zeile „Pauschale“? */
  function druecktPauschale(q: Quelle): boolean {
    const zeilen = preiseFromQuotation("kottke", q)?.pauschale_positionen;
    return zeilen?.length === 1 && zeilen[0].titel === "Pauschale" && zeilen[0].betrag === Number(q.fixedPrice);
  }

  it.each(faelle)("$fall", ({ q, pauschale }) => {
    expect(druecktPauschale(q)).toBe(pauschale);
    expect(festpreisAlsPauschale(q)).toBe(pauschale);
  });
});

describe("attachDocumentJobContext: Kalkulationsversion für den VPS-Weg (Review 4)", () => {
  const quotation = (calculationVersionId: string | null) => ({
    id: "q1", isVariable: false, fixedPrice: "1720.00", lineItems: kernUndHebel, documentDetails: null,
    serviceType: "move", validUntil: null, depositRequiredCents: null, paymentMethodPreference: null, calculationVersionId,
  });

  it("schickt dem VPS keine Kalkulationsversion, auch nicht aus dem Browser", async () => {
    jobMocks.getQuotation.mockResolvedValue(quotation("ver_2"));
    const { params: p, kv } = await attachDocumentJobContext("ws_1", { _deal_record_id: "deal_1", document_type: "KV", firma: "kottke", _calculation_version_id: "ver_9" });
    expect(p).not.toHaveProperty("_calculation_version_id");
    expect(p.preise).toMatchObject({ modell: "pauschale" });
    // Den Bezug hält das Job-Register: Version und Preis aus derselben Lesung.
    expect(kv).toEqual({ calculationVersionId: "ver_2", priceCents: 172000 });
  });

  it("liest die Quotation konsistent (Kopf und Posten aus einem Stand)", async () => {
    jobMocks.getQuotation.mockResolvedValue(quotation("ver_2"));
    await attachDocumentJobContext("ws_1", { _deal_record_id: "deal_1", document_type: "KV", firma: "kottke" });
    expect(jobMocks.getQuotation).toHaveBeenLastCalledWith("deal_1", { konsistent: true });
  });

  it("KV ohne Version (Altbestand): Bezug ohne Version, Preis bleibt", async () => {
    jobMocks.getQuotation.mockResolvedValue(quotation(null));
    const { kv } = await attachDocumentJobContext("ws_1", { _deal_record_id: "deal_1", document_type: "KV", firma: "kottke" });
    expect(kv).toEqual({ calculationVersionId: null, priceCents: 172000 });
  });

  it("AB und Rechnung tragen keinen KV-Bezug", async () => {
    jobMocks.getQuotation.mockResolvedValue(quotation("ver_2"));
    for (const document_type of ["AB", "RE"]) {
      const { kv } = await attachDocumentJobContext("ws_1", { _deal_record_id: "deal_1", document_type, firma: "kottke" });
      expect(kv).toBeNull();
    }
  });

  it("ohne Deal: Parameter unverändert, kein Bezug", async () => {
    const r = await attachDocumentJobContext("ws_1", { document_type: "KV", _calculation_version_id: "x" });
    expect(r).toEqual({ params: { document_type: "KV" }, kv: null });
  });

  const stundenAngebot = (transporter: number) => ({
    ...quotation("ver_2"),
    isVariable: true,
    fixedPrice: null,
    lineItems: [
      { type: "helper", description: "Helfer", quantity: 3, unitRate: "35" },
      { type: "transporter", description: "Transporter", quantity: transporter, unitRate: "25" },
    ],
    documentDetails: {
      stunden: {
        helfer: 3,
        transporter,
        stundenGeschaetzt: 7.5,
        mindestStunden: 3,
        satzHelferEur: 35,
        satzTransporterEur: 25,
        summeGeschaetztCent: 97_500,
        mindestbetragCent: 39_000,
        quelle: "version",
      },
    },
  });

  it("Stunden-KV mit einem Transporter: Stunden an den VPS, Schätzung als Betrag (K1, K2)", async () => {
    jobMocks.zeilen.clear();
    jobMocks.getQuotation.mockResolvedValue(stundenAngebot(1));
    const { params, kv } = await attachDocumentJobContext("ws_1", { _deal_record_id: "deal_1", document_type: "KV", firma: "kottke" });
    expect(params.preise).toMatchObject({ modell: "stundensatz", helfer_anzahl: 3, stunden_geschaetzt: 7.5, mindest_stunden: 3, stundensatz_transporter_eur: 25 });
    // Nicht die Summe der Stundensätze (3 × 35 + 25 = 130 €).
    expect(params._document_context).toEqual({ paidCents: 0, totalCents: 97_500 });
    expect(kv).toEqual({ calculationVersionId: "ver_2", priceCents: 97_500 });
  });

  it("Stunden-KV mit zwei Transportern: der Auftrag scheitert mit Meldung (K1)", async () => {
    jobMocks.zeilen.clear();
    jobMocks.getQuotation.mockResolvedValue(stundenAngebot(2));
    await expect(
      attachDocumentJobContext("ws_1", { _deal_record_id: "deal_1", document_type: "KV", firma: "kottke" })
    ).rejects.toThrow(/genau einem Transporter/);
  });

  it("AB eines Stunden-KV: Stunden und Betrag aus der Annahme, nicht aus der Transporter-Menge (K2)", async () => {
    jobMocks.zeilen.clear();
    // Die aktuelle Quotation ist inzwischen von Hand gelöst; die AB folgt der Annahme.
    jobMocks.getQuotation.mockResolvedValue({ ...stundenAngebot(1), calculationVersionId: null, documentDetails: null });
    jobMocks.zeilen.set(kvaConfirmations, [
      {
        confirmedTotalCents: 97_500,
        quotationSnapshot: {
          isVariable: true,
          fixedPriceCents: null,
          totalCents: 97_500,
          calculationVersionId: "ver_2",
          stundenModell: "version",
          stunden: stundenAngebot(1).documentDetails.stunden,
          lineItems: [
            { type: "helper", description: "Helfer", quantity: 3, unitRate: 35, lineTotal: 105 },
            { type: "transporter", description: "Transporter", quantity: 1, unitRate: 25, lineTotal: 25 },
          ],
        },
      },
    ]);
    const { params } = await attachDocumentJobContext("ws_1", { _deal_record_id: "deal_1", document_type: "AB", firma: "kottke" });
    expect(params.preise).toMatchObject({ modell: "stundensatz", stunden_geschaetzt: 7.5, mindest_stunden: 3 });
    expect(params._document_context).toEqual({ paidCents: 0, totalCents: 97_500 });
    jobMocks.zeilen.clear();
  });
});


describe("attachDocumentJobContext: Umzugsgutliste Demontage/Montage aus der Kalkulation (KV-Meldung 10.11.)", () => {
  it("zerlegte Möbel der gesperrten Version stehen als Firma, nicht als „Nicht vorgesehen“", async () => {
    const { dealInventoryItems } = await import("@/db/schema/inventory");
    const { dealCalculationVersions } = await import("@/db/schema/deal-calculation-versions");
    const zeile = (name: string) => ({ name, quantity: 1, moveFlag: true, category: "Möbel", notes: null, dismantlingOwner: "none", assemblyOwner: "none" });
    jobMocks.zeilen.set(dealInventoryItems, [zeile("Doppelbett mit Polsterkopfteil"), zeile("Sitzbank dunkel")]);
    jobMocks.zeilen.set(dealCalculationVersions, [
      {
        rechnerRequest: { montage_je_position: "1", positionen_freitext: [{ name: "Doppelbett mit Polsterkopfteil", menge: 1 }, { name: "Sitzbank dunkel", menge: 1 }] },
        rechnerResult: {
          positionen: [
            { name: "Doppelbett mit Polsterkopfteil", menge: 1, volumenCbm: 1.6, zerlegt: true },
            { name: "Sitzbank dunkel", menge: 1, volumenCbm: 0.4, zerlegt: false },
          ],
        },
      },
    ]);
    jobMocks.getQuotation.mockResolvedValue({
      id: "q1", isVariable: false, fixedPrice: "1720.00", lineItems: kernUndHebel, serviceType: "move", validUntil: null,
      depositRequiredCents: null, paymentMethodPreference: null, calculationVersionId: "ver_3",
      documentDetails: { services: { transport: { owner: "company" }, dismantling: { owner: "company", note: "Doppelbett." }, assembly: { owner: "company", note: "Doppelbett." } } },
    });
    try {
      const { params: p } = await attachDocumentJobContext("ws_1", { _deal_record_id: "deal_1", document_type: "KV", firma: "kottke" });
      const inv = (p.document_details as { inventory: Array<{ name: string; dismantling: string; assembly: string }> }).inventory;
      expect(inv.map((r) => [r.name, r.dismantling, r.assembly])).toEqual([
        ["Doppelbett mit Polsterkopfteil", "company", "company"],
        ["Sitzbank dunkel", "none", "none"],
      ]);
    } finally {
      jobMocks.zeilen.delete(dealInventoryItems);
      jobMocks.zeilen.delete(dealCalculationVersions);
    }
  });
});

describe("attachDocumentJobContext: Strecke geht unverändert an den VPS (Inhaber 10.11.)", () => {
  it("Einzug ohne Straße und „wird noch abgestimmt“ bleiben Textzeilen in auftrag.strecke_nach", async () => {
    jobMocks.getQuotation.mockResolvedValue(null);
    for (const nach of ["71032 Böblingen", "Böblingen", "wird noch abgestimmt"]) {
      const { params: p } = await attachDocumentJobContext("ws_1", {
        _deal_record_id: "deal_1",
        document_type: "KV",
        firma: "kottke",
        auftrag: { strecke_von: "Westfalenstr. 1, 71640, Ludwigsburg", strecke_nach: nach },
      });
      expect(p.auftrag).toEqual({ strecke_von: "Westfalenstr. 1, 71640, Ludwigsburg", strecke_nach: nach });
    }
  });
});

describe("attachDocumentJobContext: abgewählte Montage in der Umzugsgutliste (Review I2)", () => {
  it.each(["kottke", "ceylan"])("%s: Leistungen beim Kunden, Wahl „wir“: Tabelle zeigt Kunde", async (firma) => {
    const { dealInventoryItems } = await import("@/db/schema/inventory");
    const { dealCalculationVersions } = await import("@/db/schema/deal-calculation-versions");
    jobMocks.zeilen.set(dealInventoryItems, [{ name: "Doppelbett", quantity: 1, moveFlag: true, category: "Möbel", notes: null, dismantlingOwner: "company", assemblyOwner: "company" }]);
    jobMocks.zeilen.set(dealCalculationVersions, [
      {
        rechnerRequest: { montage_je_position: "1", positionen_freitext: [{ name: "Doppelbett", menge: 1, abbau: "company", aufbau: "company" }] },
        rechnerResult: { positionen: [{ name: "Doppelbett", menge: 1, volumenCbm: 1.6, zerlegt: true }] },
      },
    ]);
    jobMocks.getQuotation.mockResolvedValue({
      id: "q1", isVariable: false, fixedPrice: "1720.00", lineItems: kernUndHebel, serviceType: "move", validUntil: null,
      depositRequiredCents: null, paymentMethodPreference: null, calculationVersionId: "ver_3",
      documentDetails: { services: { dismantling: { owner: "customer", note: "Den Abbau übernehmen Sie selbst." }, assembly: { owner: "customer", note: "Den Aufbau übernehmen Sie selbst." } } },
    });
    try {
      const { params: p } = await attachDocumentJobContext("ws_1", { _deal_record_id: "deal_1", document_type: "KV", firma });
      const inv = (p.document_details as { inventory: Array<{ dismantling: string; assembly: string }> }).inventory;
      expect(inv).toEqual([expect.objectContaining({ dismantling: "customer", assembly: "customer" })]);
    } finally {
      jobMocks.zeilen.delete(dealInventoryItems);
      jobMocks.zeilen.delete(dealCalculationVersions);
    }
  });
});


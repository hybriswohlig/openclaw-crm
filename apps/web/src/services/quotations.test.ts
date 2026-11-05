import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  quotationRows: [] as unknown[][],
  lineRows: [] as unknown[][],
  updateSet: vi.fn(),
  txDelete: vi.fn(),
  txInsertValues: vi.fn(),
}));

vi.mock("@/db", () => {
  const select = () => ({
    from: () => ({
      where: () => ({
        limit: async () => m.quotationRows.shift() ?? [],
        orderBy: async () => m.lineRows.shift() ?? [],
      }),
    }),
  });
  const update = () => ({
    set: (values: Record<string, unknown>) => {
      m.updateSet(values);
      return { where: () => ({ returning: async () => [{ id: "q1" }] }) };
    },
  });
  const insert = () => ({ values: () => ({ returning: async () => [{ id: "q1" }] }) });
  const transaction = async (fn: (tx: unknown) => Promise<void>) =>
    fn({
      delete: () => ({ where: async () => m.txDelete() }),
      insert: () => ({ values: async (v: unknown) => m.txInsertValues(v) }),
    });
  return { db: { select, update, insert, transaction } };
});
vi.mock("./kva-annahme", () => ({ pruefeNichtAngenommen: vi.fn(async () => undefined) }));

import { upsertQuotation } from "./quotations";

const gespeichert = {
  id: "q1",
  dealRecordId: "deal1",
  fixedPrice: "990.00",
  isVariable: false,
  notes: "alt",
  summary: "Umzug",
  validUntil: null,
  depositRequiredCents: null,
  paymentMethodPreference: null,
  showStandardInclusions: true,
  selectedPackageSlug: null,
  calculationAssumptions: null,
  documentDetails: null,
  calculationVersionId: "v2",
};
const gespeichertePosten = [
  { id: "l1", quotationId: "q1", type: "helper", description: "Arbeitsstunden (ohne Küche)", quantity: 10, unitRate: "60.00", sortOrder: 0 },
  { id: "l2", quotationId: "q1", type: "other", description: "Halteverbotszone", quantity: 1, unitRate: "390.00", sortOrder: 1 },
];
const postenEingabe = gespeichertePosten.map(({ type, description, quantity, unitRate, sortOrder }) => ({
  type,
  description,
  quantity,
  unitRate,
  sortOrder,
}));

/** Lädt für jeden getQuotation-Aufruf (vorher, nachher) den gespeicherten Stand. */
function ladeBestand() {
  m.quotationRows = [[gespeichert], [gespeichert]];
  m.lineRows = [gespeichertePosten, gespeichertePosten];
}

function gesetzt(): Record<string, unknown> {
  expect(m.updateSet).toHaveBeenCalledTimes(1);
  return m.updateSet.mock.calls[0][0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  ladeBestand();
});

describe("upsertQuotation löst die Kalkulationsversion bei Handänderung", () => {
  it("geänderter Festpreis setzt calculationVersionId auf null", async () => {
    await upsertQuotation("deal1", { fixedPrice: "1100.00", isVariable: false });
    expect(gesetzt()).toMatchObject({ calculationVersionId: null, fixedPrice: "1100.00" });
  });

  it("nur Notizen, Beschreibung, Gültigkeit, Anzahlung geändert: Verknüpfung bleibt", async () => {
    await upsertQuotation("deal1", {
      fixedPrice: "990.00",
      isVariable: false,
      notes: "neu",
      summary: "Umzug mit Küche",
      validUntil: "2026-12-01",
      depositRequiredCents: 20000,
    });
    expect(gesetzt()).not.toHaveProperty("calculationVersionId");
  });

  it("Festpreis gleich in anderer Schreibweise zählt nicht als Änderung", async () => {
    await upsertQuotation("deal1", { fixedPrice: "990", isVariable: false });
    expect(gesetzt()).not.toHaveProperty("calculationVersionId");
  });

  it("isVariable geändert löst die Version", async () => {
    await upsertQuotation("deal1", { fixedPrice: "990.00", isVariable: true });
    expect(gesetzt()).toMatchObject({ calculationVersionId: null });
  });

  it("gleiche Posten nach Normalisierung (Komma, Zahl) lassen die Verknüpfung stehen", async () => {
    await upsertQuotation("deal1", {
      fixedPrice: "990.00",
      isVariable: false,
      lineItems: [
        { type: "helper", description: " Arbeitsstunden (ohne Küche) ", quantity: 10, unitRate: "60,00", sortOrder: 0 },
        { type: "other", description: "Halteverbotszone", quantity: 1, unitRate: 390, sortOrder: 1 },
      ],
    });
    expect(gesetzt()).not.toHaveProperty("calculationVersionId");
    expect(m.txInsertValues).toHaveBeenCalledTimes(1);
  });

  it("geänderter Postenbetrag löst die Version", async () => {
    await upsertQuotation("deal1", {
      fixedPrice: "990.00",
      isVariable: false,
      lineItems: [postenEingabe[0], { ...postenEingabe[1], unitRate: "400.00" }],
    });
    expect(gesetzt()).toMatchObject({ calculationVersionId: null });
  });

  it("geänderter Postentext löst die Version", async () => {
    await upsertQuotation("deal1", {
      fixedPrice: "990.00",
      isVariable: false,
      lineItems: [postenEingabe[0], { ...postenEingabe[1], description: "Halteverbot beidseitig" }],
    });
    expect(gesetzt()).toMatchObject({ calculationVersionId: null });
  });

  it("geänderte Reihenfolge der Posten löst die Version", async () => {
    await upsertQuotation("deal1", {
      fixedPrice: "990.00",
      isVariable: false,
      lineItems: [
        { ...postenEingabe[1], sortOrder: 0 },
        { ...postenEingabe[0], sortOrder: 1 },
      ],
    });
    expect(gesetzt()).toMatchObject({ calculationVersionId: null });
  });

  it("neuer Rabatt verändert die Posten und löst die Version", async () => {
    await upsertQuotation("deal1", {
      fixedPrice: "990.00",
      isVariable: false,
      discount: { label: "Stammkunde", amount: 50 },
    });
    expect(gesetzt()).toMatchObject({ calculationVersionId: null });
  });

  it("ohne Posten und Rabatt gelten die gespeicherten Posten als unverändert", async () => {
    await upsertQuotation("deal1", { fixedPrice: "990.00", isVariable: false, notes: "x" });
    expect(gesetzt()).not.toHaveProperty("calculationVersionId");
    expect(m.txInsertValues).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  /** Lesen ohne Transaktion (getQuotation nach dem Speichern). */
  quotationRows: [] as unknown[][],
  lineRows: [] as unknown[][],
  /** Lesen in der Transaktion (der Stand, mit dem verglichen wird). */
  txQuotationRows: [] as unknown[][],
  txLineRows: [] as unknown[][],
  updateSet: vi.fn(),
  txDelete: vi.fn(),
  txInsertValues: vi.fn(),
  txExecute: vi.fn(),
  sperrArt: vi.fn(),
  reihenfolge: [] as string[],
}));

vi.mock("@/db", async () => {
  const { quotationLineItems } = await import("@/db/schema");
  const lesen = (quellen: { kopf: () => unknown[][]; posten: () => unknown[][] }, imTx: boolean) => () => ({
    from: () => ({
      where: () => ({
        limit: () => {
          if (imTx) m.reihenfolge.push("lesen");
          const p = Promise.resolve(quellen.kopf().shift() ?? []);
          return Object.assign(p, {
            for: (art: string) => {
              m.sperrArt(art);
              return p;
            },
          });
        },
        orderBy: async () => quellen.posten().shift() ?? [],
      }),
    }),
  });
  const update = () => ({
    set: (values: Record<string, unknown>) => {
      m.reihenfolge.push("kopf");
      m.updateSet(values);
      return { where: () => ({ returning: async () => [{ id: "q1" }] }) };
    },
  });
  const insert = (tabelle: unknown) => ({
    values: (v: unknown) => {
      if (tabelle === quotationLineItems) {
        m.reihenfolge.push("posten");
        m.txInsertValues(v);
        return Promise.resolve();
      }
      m.reihenfolge.push("kopf");
      return { returning: async () => [{ id: "q1" }] };
    },
  });
  const ausserhalb = () => {
    throw new Error("Schreiben außerhalb der Transaktion");
  };
  const transaction = async (fn: (tx: unknown) => Promise<void>) =>
    fn({
      execute: async (q: unknown) => {
        m.reihenfolge.push("sperre");
        return m.txExecute(q);
      },
      select: lesen({ kopf: () => m.txQuotationRows, posten: () => m.txLineRows }, true),
      update,
      insert,
      delete: () => ({ where: async () => m.txDelete() }),
    });
  return {
    db: {
      select: lesen({ kopf: () => m.quotationRows, posten: () => m.lineRows }, false),
      update: ausserhalb,
      insert: ausserhalb,
      transaction,
    },
  };
});
vi.mock("./kva-annahme", () => ({ pruefeNichtAngenommen: vi.fn(async () => undefined) }));

import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { QuotationInputError, upsertQuotation } from "./quotations";

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

/** Gespeicherter Stand für das Lesen in der Transaktion und für getQuotation danach. */
function ladeBestand() {
  m.txQuotationRows = [[gespeichert]];
  m.txLineRows = [gespeichertePosten];
  m.quotationRows = [[gespeichert]];
  m.lineRows = [gespeichertePosten];
}

function gesetzt(): Record<string, unknown> {
  expect(m.updateSet).toHaveBeenCalledTimes(1);
  return m.updateSet.mock.calls[0][0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.reihenfolge.length = 0;
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

describe("upsertQuotation unter der Sperre des Angebots (Review 3)", () => {
  it("nimmt zuerst die Sperre je Deal, liest die Zeile FOR UPDATE, schreibt Kopf und Posten in derselben Transaktion", async () => {
    await upsertQuotation("deal1", { fixedPrice: "990.00", isVariable: false, lineItems: postenEingabe });
    expect(m.reihenfolge).toEqual(["sperre", "lesen", "kopf", "posten"]);
    const q = new PgDialect().sqlToQuery(m.txExecute.mock.calls[0][0] as SQL);
    expect(q.sql).toBe("select pg_advisory_xact_lock(hashtext('angebot:' || $1::text))");
    expect(q.params).toEqual(["deal1"]);
    expect(m.sperrArt).toHaveBeenCalledWith("update");
  });

  it("Formular mit altem Stand (v1, 1.000 €), inzwischen v2 gesperrt (1.500 €): Vergleich mit dem gesperrten Lesen löst die Verknüpfung", async () => {
    // Vor der Transaktion hätte ein Lesen noch v1 gesehen; zählt nur das Lesen unter der Sperre.
    m.quotationRows = [[{ ...gespeichert, fixedPrice: "1000.00", calculationVersionId: "v1" }]];
    m.txQuotationRows = [[{ ...gespeichert, fixedPrice: "1500.00", calculationVersionId: "v2" }]];
    await upsertQuotation("deal1", { fixedPrice: "1000.00", isVariable: false, notes: "nur Notiz" });
    expect(gesetzt()).toMatchObject({ calculationVersionId: null, fixedPrice: "1000.00", notes: "nur Notiz" });
  });

  it("ohne Quotation: Anlegen in der Transaktion unter der Sperre", async () => {
    m.txQuotationRows = [[]];
    await upsertQuotation("deal1", { fixedPrice: "500.00", isVariable: false });
    expect(m.reihenfolge).toEqual(["sperre", "lesen", "kopf"]);
    expect(m.updateSet).not.toHaveBeenCalled();
  });

  it("ungültiger Posten scheitert vor jedem Schreiben", async () => {
    await expect(
      upsertQuotation("deal1", { fixedPrice: "990.00", isVariable: false, lineItems: [{ type: "other", quantity: Number.NaN, unitRate: "x", sortOrder: 0 }] })
    ).rejects.toBeInstanceOf(QuotationInputError);
    expect(m.updateSet).not.toHaveBeenCalled();
    expect(m.txInsertValues).not.toHaveBeenCalled();
  });
});

/**
 * Vorbelegung des Dokument-Dialogs (AB, Rechnung) aus dem Angebot des Deals.
 * Die frühere private `prefillFromQuotation` aus `components/inbox/context-panel.tsx`,
 * unverändert verschoben, damit die Umzugsakte (Plan 3, Task 14) sie mitnutzt.
 * Reine Logik, kein Netz.
 */
import type { PrefilledPreise } from "@/components/GenerateDocumentDialog";
import { festpreisAlsPauschale, istBepreist } from "@/lib/festpreis-posten";

/** Die Felder des Angebots (`GET /deals/{id}/quotation`), die die Vorbelegung liest. */
export interface Angebot {
  fixedPrice: string | null;
  isVariable: boolean;
  lineItems: Array<{
    type: "helper" | "transporter" | "other";
    description?: string | null;
    quantity: number;
    unitRate: string;
  }>;
  depositRequiredCents?: number | null;
  paymentMethodPreference?: "bank_transfer" | "paypal" | "cash" | "card" | null;
  /** Gesperrte Kalkulationsversion, aus der die Preise stammen (Plan 5a). */
  calculationVersionId?: string | null;
}

/**
 * Preisblock für den VPS-Renderer (KV und AB). Beim Festpreis kommen die Posten
 * nur ins Dokument, wenn ihre Summe genau der Festpreis ist (Kern + Hebel aus
 * der Übernahme). Sonst gibt es eine Zeile „Pauschale“, damit Posten und
 * Gesamtbetrag nie auseinanderlaufen, etwa wenn der Preis geändert wurde und
 * Posten eines älteren Stands übrig sind. Der Stundensatz bleibt wie er war.
 * Die Entscheidung trifft festpreisAlsPauschale, dieselbe wie für den Hinweis
 * im Fenster „Es fehlen noch Angaben“. Server (`preiseFromQuotation`) und
 * VPS-Dialog (Posten der Version, schreibgeschützt) nutzen diese Funktion.
 */
export function vpsPreise(
  firma: string,
  q: {
    isVariable: boolean;
    fixedPrice: string | null;
    lineItems: Array<{
      type: string;
      description?: string | null;
      quantity: number;
      unitRate: string;
    }>;
  }
) {
  if (firma === "ceylan" && q.fixedPrice) {
    return { modell: "pauschale" as const, pauschale_betrag: Number(q.fixedPrice) };
  }
  if (q.isVariable) {
    const helpers = q.lineItems.filter((i) => i.type === "helper");
    const trucks = q.lineItems.filter((i) => i.type === "transporter");
    if (helpers.length && trucks.length) {
      const helfer = helpers[0];
      const truck = trucks[0];
      return {
        modell: "stundensatz" as const,
        helfer_anzahl: Math.max(1, Math.round(helfer.quantity)),
        stunden_geschaetzt: truck.quantity,
        mindest_stunden: truck.quantity,
        stundensatz_helfer_eur: Number(helfer.unitRate),
        stundensatz_transporter_eur: Number(truck.unitRate),
      };
    }
  }
  if (festpreisAlsPauschale(q)) {
    return {
      modell: "pauschale" as const,
      pauschale_positionen: [{ titel: "Pauschale", betrag: Number(q.fixedPrice) }],
    };
  }
  const positionen = q.lineItems.filter(istBepreist).map((i) => ({
    titel: i.description || "Leistung",
    betrag: Number(i.unitRate) * i.quantity,
  }));
  if (positionen.length) {
    return { modell: "pauschale" as const, pauschale_positionen: positionen };
  }
  return null;
}

export type VpsPreise = NonNullable<ReturnType<typeof vpsPreise>>;

/** Map quotation values to the GenerateDocumentDialog prefill shape. */
export function vorbelegungAusAngebot(
  q: Angebot | null,
  firma: "kottke" | "ceylan"
): PrefilledPreise | undefined {
  if (!q) return undefined;
  const prefill: PrefilledPreise = {};
  // Quotation aus einer gesperrten Version: der Dialog zeigt genau die Posten,
  // die der VPS druckt, schreibgeschützt (Entscheidung 5a-8).
  const ausVersion = q.calculationVersionId ? vpsPreise(firma, q) : null;
  if (q.calculationVersionId && ausVersion) {
    prefill.ausVersion = { versionId: q.calculationVersionId, preise: ausVersion };
  }
  if (q.depositRequiredCents != null && q.depositRequiredCents > 0) {
    prefill.anzahlungBar = q.depositRequiredCents / 100;
    prefill.anzahlungMethod =
      q.paymentMethodPreference === "paypal"
        ? "paypal"
        : q.paymentMethodPreference === "bank_transfer"
          ? "bank_transfer"
          : "bar";
  }
  if (!q.isVariable && q.fixedPrice && Number(q.fixedPrice) > 0) {
    if (firma === "ceylan") {
      prefill.modell = "pauschale";
      prefill.pauschaleBetragCeylan = Number(q.fixedPrice);
    } else {
      prefill.modell = "pauschale";
      prefill.pauschalePositionen = [
        { titel: "Umzug pauschal", betrag: Number(q.fixedPrice) },
      ];
    }
    return prefill;
  }
  if (q.isVariable && q.lineItems?.length) {
    const helpers = q.lineItems.filter((l) => l.type === "helper");
    const transporters = q.lineItems.filter((l) => l.type === "transporter");
    prefill.modell = "stundensatz";
    if (helpers.length > 0) {
      prefill.helferAnzahl = helpers.reduce((s, l) => s + l.quantity, 0);
      prefill.helferRate = Number(helpers[0].unitRate) || undefined;
    }
    if (transporters.length > 0) {
      prefill.transporterRate = Number(transporters[0].unitRate) || undefined;
    }
    return prefill;
  }
  return Object.keys(prefill).length > 0 ? prefill : undefined;
}

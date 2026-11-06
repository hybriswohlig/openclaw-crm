/**
 * Vorbelegung des Dokument-Dialogs (AB, Rechnung) aus dem Angebot des Deals.
 * Die frühere private `prefillFromQuotation` aus `components/inbox/context-panel.tsx`,
 * unverändert verschoben, damit die Umzugsakte (Plan 3, Task 14) sie mitnutzt.
 * Reine Logik, kein Netz.
 */
import type { PrefilledPreise } from "@/components/GenerateDocumentDialog";

/** Die Felder des Angebots (`GET /deals/{id}/quotation`), die die Vorbelegung liest. */
export interface Angebot {
  fixedPrice: string | null;
  isVariable: boolean;
  lineItems: Array<{
    type: "helper" | "transporter" | "other";
    quantity: number;
    unitRate: string;
  }>;
  depositRequiredCents?: number | null;
  paymentMethodPreference?: "bank_transfer" | "paypal" | "cash" | "card" | null;
}

/** Map quotation values to the GenerateDocumentDialog prefill shape. */
export function vorbelegungAusAngebot(
  q: Angebot | null,
  firma: "kottke" | "ceylan"
): PrefilledPreise | undefined {
  if (!q) return undefined;
  const prefill: PrefilledPreise = {};
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

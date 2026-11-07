/**
 * Vorbelegung des Dokument-Dialogs (AB, Rechnung) aus dem Angebot des Deals.
 * Die frühere private `prefillFromQuotation` aus `components/inbox/context-panel.tsx`,
 * unverändert verschoben, damit die Umzugsakte (Plan 3, Task 14) sie mitnutzt.
 * Reine Logik, kein Netz.
 */
import type { PrefilledPreise } from "@/components/GenerateDocumentDialog";
import { festpreisAlsPauschale, istBepreist } from "@/lib/festpreis-posten";
import { stundenAngebotAus, type PortalStundenAngebot } from "@openclaw-crm/customer-portal-core";

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
  /** Plan 5b: `document_details.stunden` beim Stunden-KV aus der Version. */
  documentDetails?: { stunden?: unknown } | null;
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

/** Ein Stunden-KV aus der Version, den der VPS nicht richtig drucken kann: lieber kein PDF als ein falsches. */
export class VpsStundenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VpsStundenError";
  }
}

/** Quelle für den VPS-Preisblock: Angebot plus Version und `document_details.stunden` (Plan 5b). */
export type VpsPreisQuelle = Parameters<typeof vpsPreise>[1] & {
  calculationVersionId?: string | null;
  documentDetails?: { stunden?: unknown } | null;
};

/**
 * `document_details.stunden` eines Stunden-KV aus der Version. Nur solange die
 * Quotation an einer Version hängt: von Hand geänderte Sätze lösen den Bezug,
 * dann gilt die alte Ableitung aus den Posten (wie im Portal).
 */
export function vpsStundenAusVersion(q: VpsPreisQuelle): PortalStundenAngebot | null {
  if (!q.isVariable || !q.calculationVersionId) return null;
  return stundenAngebotAus(q.documentDetails?.stunden);
}

/**
 * Preisblock für den VPS mit Stunden-KV aus der Version. Der VPS-Block
 * `stundensatz` kennt Helfer, einen Transportersatz und die Stunden, aber weder
 * die Zahl der Transporter noch feste Zusatzposten. Er druckt den Satz für genau
 * einen Transporter. Darum: bei genau einem Transporter alle Werte aus der
 * Version, sonst ein Fehler statt eines PDFs mit falschem Stundensatz.
 * Ohne Stunden aus der Version wie `vpsPreise`.
 */
export function vpsPreiseMitStunden(firma: string, q: VpsPreisQuelle): VpsPreise | null {
  const preise = vpsPreise(firma, q);
  const s = vpsStundenAusVersion(q);
  if (!s || !preise || preise.modell !== "stundensatz") return preise;
  if (s.transporter !== 1) {
    throw new VpsStundenError(
      `Der VPS druckt einen Stunden-KV nur mit genau einem Transporter, dieses Angebot hat ${s.transporter}. Bitte in der Kalkulation anpassen und neu sperren.`
    );
  }
  const zusatz = q.lineItems.some((i) => i.type !== "helper" && i.type !== "transporter" && Number(i.unitRate) * i.quantity !== 0);
  if (zusatz) {
    throw new VpsStundenError(
      "Der VPS druckt einen Stunden-KV ohne feste Zusatzposten. Bitte die Zusatzposten in der Kalkulation entfernen und neu sperren."
    );
  }
  return {
    modell: "stundensatz" as const,
    helfer_anzahl: s.helfer,
    stunden_geschaetzt: s.stundenGeschaetzt,
    mindest_stunden: s.mindestStunden,
    stundensatz_helfer_eur: s.satzHelferEur,
    stundensatz_transporter_eur: s.satzTransporterEur,
  };
}

/** Map quotation values to the GenerateDocumentDialog prefill shape. */
export function vorbelegungAusAngebot(
  q: Angebot | null,
  firma: "kottke" | "ceylan"
): PrefilledPreise | undefined {
  if (!q) return undefined;
  const prefill: PrefilledPreise = {};
  // Quotation aus einer gesperrten Version: der Dialog zeigt genau die Posten,
  // die der VPS druckt, schreibgeschützt (Entscheidung 5a-8).
  // Kann der VPS den Stunden-KV nicht drucken, zeigt der Dialog keine Versionspreise;
  // der Server lehnt den Auftrag dann mit derselben Meldung ab.
  let ausVersion: VpsPreise | null = null;
  try {
    ausVersion = q.calculationVersionId ? vpsPreiseMitStunden(firma, q) : null;
  } catch (err) {
    if (!(err instanceof VpsStundenError)) throw err;
  }
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

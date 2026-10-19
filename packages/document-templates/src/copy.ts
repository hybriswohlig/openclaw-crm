/**
 * Default KV / AB / RE sentences, versioned with TEMPLATE_VERSION.
 *
 * The service is chosen from the quotation type and the deal signals.
 * Sie/du only changes the pronouns and the greeting. Euro amounts are
 * never written here: the price block is the only place a figure appears.
 * Optional copy.intro / copy.closing / copy.remarks replace the matching
 * default and cannot change the total.
 */
import { formatGermanDate } from "./money";
import type {
  AddressForm,
  DocKind,
  DocumentCopy,
  DocumentServiceKind,
  ServiceSignals,
} from "./types";

const COMPANY_FORM =
  /\b(gmbh|ggmbh|ag|ug|se|kgaa|kg|ohg|gbr|mbh|partg|e\.?\s?v\.?|e\.?\s?kfm\.?|e\.?\s?k\.?|ltd\.?|inc\.?|stiftung|genossenschaft)\b/i;

export interface SelectedService {
  kind: DocumentServiceKind;
  label: string;
}

export function looksLikeCompanyName(name: string | null | undefined): boolean {
  if (!name) return false;
  return COMPANY_FORM.test(name.trim());
}

function normLead(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Quotation type wins when it is Küche or Entrümpelung. `move` is the column
 * default, so a lead type or an Auftrag flag can still select another text.
 * `showStandardInclusions: false` means a one-off transport, even when the
 * lead still says Umzug.
 */
export function selectDocumentService(
  serviceType: string | null | undefined,
  signals: ServiceSignals = {}
): SelectedService {
  const stored = (serviceType ?? "").trim();
  const lead = normLead(signals.leadType);
  const inclusionsOff = signals.showStandardInclusions === false;
  const piano = signals.pianoTransport === true;
  const storage = signals.storageRequired === true;

  if (stored === "kitchen_installation") {
    return { kind: "kitchen", label: "Küchenmontage" };
  }
  if (stored === "clearance") {
    return { kind: "clearance", label: "Entrümpelung" };
  }
  if (stored && stored !== "move") {
    return { kind: "other", label: "Leistung" };
  }
  if (
    lead === "kueche" ||
    lead === "kuechenmontage" ||
    lead === "kitchen" ||
    lead === "kitcheninstallation"
  ) {
    return { kind: "kitchen", label: "Küchenmontage" };
  }
  if (lead === "entruempelung" || lead === "entrumpelung") {
    return { kind: "clearance", label: "Entrümpelung" };
  }
  if (lead === "lager" || lead === "einlagerung") {
    return { kind: "storage", label: "Einlagerung" };
  }
  if (lead === "klavier" || lead === "klaviertransport" || (piano && inclusionsOff)) {
    return { kind: "transport", label: "Klaviertransport" };
  }
  if (lead === "beiladung") {
    return { kind: "transport", label: "Beiladung" };
  }
  if (lead === "transport") {
    return { kind: "transport", label: "Transport" };
  }
  if (inclusionsOff && storage && !piano) {
    return { kind: "storage", label: "Einlagerung" };
  }
  if (inclusionsOff) {
    return { kind: "transport", label: "Transport" };
  }
  if (lead && lead !== "umzug" && lead !== "fmz" && lead !== "fernumzug") {
    return { kind: "other", label: "Leistung" };
  }
  if (lead === "fmz" || lead === "fernumzug") {
    return { kind: "move", label: "Fernumzug" };
  }
  return { kind: "move", label: "Umzug" };
}

interface Nouns {
  anfrage: Record<AddressForm, string>;
  order: Record<AddressForm, string>;
  invoice: string;
  invoiceThanks: string | null;
}

function nounsFor(service: SelectedService): Nouns {
  switch (service.kind) {
    case "move":
      if (service.label === "Fernumzug") {
        return {
          anfrage: {
            sie: "Ihre Anfrage zum Fernumzug",
            du: "deine Anfrage zum Fernumzug",
          },
          order: { sie: "Ihren Fernumzug", du: "deinen Fernumzug" },
          invoice: "den Fernumzug",
          invoiceThanks: "Danke für den reibungslosen Ablauf am Umzugstag.",
        };
      }
      return {
        anfrage: { sie: "Ihre Umzugsanfrage", du: "deine Umzugsanfrage" },
        order: { sie: "Ihren Umzug", du: "deinen Umzug" },
        invoice: "die Umzugsleistung",
        invoiceThanks: "Danke für den reibungslosen Ablauf am Umzugstag.",
      };
    case "clearance":
      return {
        anfrage: {
          sie: "Ihre Anfrage zur Entrümpelung",
          du: "deine Anfrage zur Entrümpelung",
        },
        order: { sie: "die Entrümpelung", du: "die Entrümpelung" },
        invoice: "die Entrümpelung",
        invoiceThanks: null,
      };
    case "kitchen":
      return {
        anfrage: {
          sie: "Ihre Anfrage zur Küchenmontage",
          du: "deine Anfrage zur Küchenmontage",
        },
        order: { sie: "die Küchenmontage", du: "die Küchenmontage" },
        invoice: "die Küchenmontage",
        invoiceThanks: null,
      };
    case "transport":
      return transportNouns(service.label);
    case "storage":
      return {
        anfrage: {
          sie: "Ihre Anfrage zur Einlagerung",
          du: "deine Anfrage zur Einlagerung",
        },
        order: { sie: "die Einlagerung", du: "die Einlagerung" },
        invoice: "die Einlagerung",
        invoiceThanks: null,
      };
    default:
      return {
        anfrage: { sie: "Ihre Anfrage", du: "deine Anfrage" },
        order: { sie: "die beschriebene Leistung", du: "die beschriebene Leistung" },
        invoice: "die beschriebene Leistung",
        invoiceThanks: null,
      };
  }
}

function transportNouns(label: string): Nouns {
  if (label === "Beiladung") {
    return {
      anfrage: { sie: "Ihre Anfrage zur Beiladung", du: "deine Anfrage zur Beiladung" },
      order: { sie: "die Beiladung", du: "die Beiladung" },
      invoice: "die Beiladung",
      invoiceThanks: null,
    };
  }
  return {
    anfrage: {
      sie: `Ihre Anfrage zum ${label}`,
      du: `deine Anfrage zum ${label}`,
    },
    order: { sie: `den ${label}`, du: `den ${label}` },
    invoice: `den ${label}`,
    invoiceThanks: null,
  };
}

function cleanCopy(value: string | undefined): string | undefined {
  const trimmed = value?.replace(/\u0000/g, "").trim();
  return trimmed ? trimmed : undefined;
}

export function documentSalutation(input: {
  addressForm: AddressForm;
  customerName: string;
  givenName?: string | null;
}): string {
  if (looksLikeCompanyName(input.customerName)) {
    return input.addressForm === "du" ? "Hallo," : "Sehr geehrte Damen und Herren,";
  }
  if (input.addressForm === "du") {
    const name = input.givenName?.trim();
    return name ? `Hallo ${name},` : "Hallo,";
  }
  return "Guten Tag,";
}

function defaultIntro(kind: DocKind, form: AddressForm, nouns: Nouns): string {
  const pronoun = form === "du" ? "dir" : "Ihnen";
  const orderWord = form === "du" ? "deinen" : "Ihren";
  if (kind === "KV") {
    return `Vielen Dank für ${nouns.anfrage[form]}. Wir unterbreiten ${pronoun} folgendes Angebot für ${nouns.order[form]}.`;
  }
  if (kind === "AB") {
    return `Vielen Dank für ${orderWord} Auftrag. Wir bestätigen ${nouns.order[form]} zu den folgenden Konditionen.`;
  }
  return `Wir berechnen ${pronoun} ${nouns.invoice} wie folgt.`;
}

function defaultClosing(kind: DocKind, nouns: Nouns): string {
  if (kind === "KV") return "Über eine Rückmeldung freuen wir uns.";
  if (kind === "AB") return "Wir freuen uns auf den Einsatz.";
  return nouns.invoiceThanks ?? "Vielen Dank.";
}

function dueClause(dueDate?: string | null, serviceDate?: string | null): string {
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return "";
  const label = formatGermanDate(dueDate);
  const before =
    !!serviceDate && /^\d{4}-\d{2}-\d{2}$/.test(serviceDate) && dueDate < serviceDate;
  return before ? ` bis spätestens ${label} (vor Einsatz)` : ` bis spätestens ${label}`;
}

/**
 * When the money is due and how it is paid. The sentence never contains an
 * amount. A missing due date stays missing: the service date is not a due date.
 * Card is mentioned only when the method is card.
 */
export function paymentDueWording(input: {
  kind: DocKind;
  addressForm: AddressForm;
  methodLabel: string;
  hasDeposit: boolean;
  openCents: number | null;
  dueDate?: string | null;
  serviceDate?: string | null;
}): string | null {
  if (input.kind === "RE" && input.openCents === 0) {
    return "Der Betrag ist ausgeglichen. Diese Rechnung gilt als Quittung.";
  }
  const due = dueClause(input.dueDate, input.serviceDate);
  if (input.methodLabel === "Karte") {
    return due
      ? `Die Zahlung erfolgt per Karte vor Ort${due}.`
      : "Die Zahlung erfolgt per Karte vor Ort.";
  }
  const noCard = " Keine Kartenzahlung vor Ort.";
  if (input.methodLabel === "Bar") {
    if (input.hasDeposit && input.kind !== "RE") {
      const when = due || " vor Auftragsbeginn";
      return `Die Anzahlung ist${when} bar zu entrichten.${noCard}`;
    }
    if (input.kind === "RE") {
      const verb = input.addressForm === "du" ? "zu zahlen" : "zu entrichten";
      return `Der offene Betrag ist${due} bar ${verb}.${noCard}`;
    }
    return `Die Zahlung erfolgt bar.${noCard}`;
  }
  if (input.methodLabel === "PayPal") {
    return `Die Zahlung erfolgt per PayPal${due}.${noCard}`;
  }
  if (input.kind === "RE") {
    const verb = input.addressForm === "du" ? "Bitte überweise" : "Bitte überweisen Sie";
    return `${verb} den offenen Betrag${due} auf das unten genannte Konto.${noCard}`;
  }
  if (input.hasDeposit) {
    const when = due || " vor Auftragsbeginn";
    return `Die Anzahlung ist${when} per Überweisung zu zahlen.${noCard}`;
  }
  return `Die Zahlung erfolgt per Überweisung.${noCard}`;
}

export interface ComposedCopy {
  service: SelectedService;
  addressForm: AddressForm;
  intro: string[];
  closing: string[];
  paymentTerms: string | null;
}

export function composeDocumentCopy(input: {
  kind: DocKind;
  serviceType: string | null | undefined;
  signals?: ServiceSignals;
  addressForm?: AddressForm | null;
  customerName: string;
  givenName?: string | null;
  serviceDate?: string | null;
  dueDate?: string | null;
  methodLabel: string;
  hasDeposit: boolean;
  openCents: number | null;
  copy?: DocumentCopy;
}): ComposedCopy {
  const addressForm: AddressForm = input.addressForm === "du" ? "du" : "sie";
  const service = selectDocumentService(input.serviceType, input.signals);
  const nouns = nounsFor(service);
  const introOverride = cleanCopy(input.copy?.intro);
  const closingOverride = cleanCopy(input.copy?.closing);
  const intro = introOverride
    ? [introOverride]
    : [
        documentSalutation({
          addressForm,
          customerName: input.customerName,
          givenName: input.givenName,
        }),
        defaultIntro(input.kind, addressForm, nouns),
      ];
  const closing = [closingOverride ?? defaultClosing(input.kind, nouns)];
  return {
    service,
    addressForm,
    intro,
    closing,
    paymentTerms: paymentDueWording({
      kind: input.kind,
      addressForm,
      methodLabel: input.methodLabel,
      hasDeposit: input.hasDeposit,
      openCents: input.openCents,
      dueDate: input.dueDate,
      serviceDate: input.serviceDate,
    }),
  };
}

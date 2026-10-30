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
  /** Short name used in the greeting, e.g. Büroumzug. */
  label: string;
  /** Included extras, e.g. "Inventar, Einpackservice und Möbelmontage". */
  detail?: string;
}

export function looksLikeCompanyName(name: string | null | undefined): boolean {
  if (!name) return false;
  return COMPANY_FORM.test(name.trim());
}

/** Company written in the deal title, e.g. "Roman Rothe (Sport-Thieme GmbH) Büroumzug". */
export function companyFromTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  for (const match of title.matchAll(/\(([^)]+)\)/g)) {
    const inner = match[1]?.trim();
    if (inner && looksLikeCompanyName(inner)) return inner;
  }
  return null;
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

function hasToken(blob: string, token: string): boolean {
  const hay = normLead(blob);
  const needle = normLead(token);
  return needle.length > 0 && hay.includes(needle);
}

function namedService(blob: string, loose: boolean): SelectedService | null {
  if (!blob.trim()) return null;
  if (hasToken(blob, "bueroumzug") || hasToken(blob, "büroumzug")) {
    return { kind: "move", label: "Büroumzug" };
  }
  if (hasToken(blob, "privatumzug")) {
    return { kind: "move", label: "Privatumzug" };
  }
  if (hasToken(blob, "fernumzug") || (loose && hasToken(blob, "fmz"))) {
    return { kind: "move", label: "Fernumzug" };
  }
  if (hasToken(blob, "entruempelung") || hasToken(blob, "entrümpelung")) {
    return { kind: "clearance", label: "Entrümpelung" };
  }
  if (
    hasToken(blob, "kuechenmontage") ||
    hasToken(blob, "küchenmontage") ||
    (loose && (hasToken(blob, "kueche") || hasToken(blob, "küche")))
  ) {
    return { kind: "kitchen", label: "Küchenmontage" };
  }
  if (hasToken(blob, "einlagerung")) {
    return { kind: "storage", label: "Einlagerung" };
  }
  if (hasToken(blob, "klaviertransport") || (loose && hasToken(blob, "klavier"))) {
    return { kind: "transport", label: "Klaviertransport" };
  }
  if (hasToken(blob, "beiladung")) {
    return { kind: "transport", label: "Beiladung" };
  }
  return null;
}

function joinGerman(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} und ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} und ${items[items.length - 1]}`;
}

function serviceDetail(signals: ServiceSignals): string | undefined {
  const blob = `${signals.title ?? ""} ${signals.mention ?? ""}`;
  const items: string[] = [];
  if (signals.inventory === true || hasToken(blob, "inventar")) items.push("Inventar");
  if (signals.packing === true || /einpack|auspack|verpack/i.test(blob)) items.push("Einpackservice");
  if (
    signals.assembly === true ||
    /möbelmontage|moebelmontage|abbau|aufbau/i.test(blob)
  ) {
    items.push("Möbelmontage");
  }
  const detail = joinGerman(items);
  return detail || undefined;
}

function withDetail(service: SelectedService, signals: ServiceSignals): SelectedService {
  const detail = serviceDetail(signals);
  return detail ? { ...service, detail } : service;
}

/**
 * Quotation type wins when it is Küche or Entrümpelung. `move` is the column
 * default, so the deal title, the Auftrag name or the lead can still name
 * Büroumzug, Privatumzug and the other services. `showStandardInclusions:
 * false` is a one-off transport only when nothing names a real service.
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
    return withDetail({ kind: "kitchen", label: "Küchenmontage" }, signals);
  }
  if (stored === "clearance") {
    return withDetail({ kind: "clearance", label: "Entrümpelung" }, signals);
  }
  if (stored && stored !== "move") {
    return withDetail({ kind: "other", label: "Leistung" }, signals);
  }

  const fromTitle = namedService(signals.title ?? "", true);
  if (fromTitle) return withDetail(fromTitle, signals);
  const fromMention = namedService(signals.mention ?? "", false);
  if (fromMention) return withDetail(fromMention, signals);

  if (
    lead === "kueche" ||
    lead === "kuechenmontage" ||
    lead === "kitchen" ||
    lead === "kitcheninstallation"
  ) {
    return withDetail({ kind: "kitchen", label: "Küchenmontage" }, signals);
  }
  if (lead === "entruempelung" || lead === "entrumpelung") {
    return withDetail({ kind: "clearance", label: "Entrümpelung" }, signals);
  }
  if (lead === "lager" || lead === "einlagerung") {
    return withDetail({ kind: "storage", label: "Einlagerung" }, signals);
  }
  if (lead === "klavier" || lead === "klaviertransport" || (piano && inclusionsOff)) {
    return withDetail({ kind: "transport", label: "Klaviertransport" }, signals);
  }
  if (lead === "beiladung") {
    return withDetail({ kind: "transport", label: "Beiladung" }, signals);
  }
  if (lead === "bueroumzug" || lead === "buero") {
    return withDetail({ kind: "move", label: "Büroumzug" }, signals);
  }
  if (lead === "privatumzug" || lead === "privat") {
    return withDetail({ kind: "move", label: "Privatumzug" }, signals);
  }
  if (lead === "transport") {
    return withDetail({ kind: "transport", label: "Transport" }, signals);
  }
  if (inclusionsOff && storage && !piano) {
    return withDetail({ kind: "storage", label: "Einlagerung" }, signals);
  }
  if (inclusionsOff) {
    return withDetail({ kind: "transport", label: "Transport" }, signals);
  }
  if (lead && lead !== "umzug" && lead !== "fmz" && lead !== "fernumzug") {
    return withDetail({ kind: "other", label: "Leistung" }, signals);
  }
  if (lead === "fmz" || lead === "fernumzug") {
    return withDetail({ kind: "move", label: "Fernumzug" }, signals);
  }
  return withDetail({ kind: "move", label: "Umzug" }, signals);
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
      if (service.label === "Büroumzug" || service.label === "Privatumzug") {
        const name = service.label;
        return {
          anfrage: {
            sie: `Ihre Anfrage zum ${name}`,
            du: `deine Anfrage zum ${name}`,
          },
          order: { sie: `Ihren ${name}`, du: `deinen ${name}` },
          invoice: `den ${name}`,
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
  businessCustomer?: boolean;
}): string {
  if (input.businessCustomer || looksLikeCompanyName(input.customerName)) {
    return "Sehr geehrte Damen und Herren,";
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
 * amount. A missing due date stays missing: the service date is not a due date,
 * and a deposit is not described as due before the job unless a due date is stored.
 * The method is the quotation's payment method. Card is mentioned only then.
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
  const channel =
    input.methodLabel === "Bar"
      ? "bar"
      : input.methodLabel === "PayPal"
        ? "per PayPal"
        : "per Überweisung";
  if (input.kind === "RE") {
    if (input.methodLabel === "Bar") {
      const verb = input.addressForm === "du" ? "zu zahlen" : "zu entrichten";
      return `Der offene Betrag ist${due} bar ${verb}.`;
    }
    if (input.methodLabel === "PayPal") {
      return `Der offene Betrag ist${due} per PayPal zu zahlen.`;
    }
    const verb = input.addressForm === "du" ? "Bitte überweise" : "Bitte überweisen Sie";
    return `${verb} den offenen Betrag${due} auf das unten genannte Konto.`;
  }
  if (input.hasDeposit) {
    const verb = input.methodLabel === "Bar" ? "zu entrichten" : "zu zahlen";
    return due
      ? `Die Anzahlung ist${due} ${channel} ${verb}.`
      : `Die Anzahlung ist ${channel} ${verb}.`;
  }
  if (input.methodLabel === "Bar") return `Die Zahlung erfolgt bar${due}.`;
  if (input.methodLabel === "PayPal") return `Die Zahlung erfolgt per PayPal${due}.`;
  return `Die Zahlung erfolgt per Überweisung${due}.`;
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
  businessCustomer?: boolean;
  serviceDate?: string | null;
  dueDate?: string | null;
  methodLabel: string;
  hasDeposit: boolean;
  openCents: number | null;
  copy?: DocumentCopy;
}): ComposedCopy {
  const business =
    input.businessCustomer === true || looksLikeCompanyName(input.customerName);
  const addressForm: AddressForm =
    business ? "sie" : input.addressForm === "du" ? "du" : "sie";
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
          businessCustomer: business,
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

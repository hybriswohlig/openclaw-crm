/**
 * German copy for KV / AB / RE renders.
 *
 * The PDF itself is produced by the crm-tools skill
 * `rechnungen-und-auftragsbestaetigungen` on the VPS. That skill still
 * hardcodes household-move wording. This module builds the strings the skill
 * must print, and `applyDocumentCopy` attaches them to the job params.
 *
 * When `document_copy.legacy_move_wording` is true the skill keeps its
 * historical move title, intro and closing. It must still honour
 * `show_card_payment`, `salutation`, `due_date_label`, `payment_terms` and
 * `hinweis` whenever those fields are set. `hinweis` is never truncated.
 */
import { CEYLAN_BRANDING, KOTTKE_BRANDING } from "@openclaw-crm/customer-portal-core";

export type InvoiceKind = "deposit" | "final";
export type PayMethod = "bank_transfer" | "paypal" | "cash" | "card";

export interface CopyLineItem {
  description?: string | null;
  quantity?: number | null;
  unitRate?: number | null;
  type?: string | null;
}

export interface CopyParty {
  fullName?: string | null;
  vorname?: string | null;
  nachname?: string | null;
  /** Set when the deal points at a companies record. */
  companyName?: string | null;
  jobTitle?: string | null;
  attention?: string | null;
  addressLines?: string[] | null;
  email?: string | null;
}

/** Deal fields the copy is derived from. Explicit params override these. */
export interface DealDocumentSource {
  serviceType?: string | null;
  showStandardInclusions?: boolean | null;
  summary?: string | null;
  notes?: string | null;
  depositEur?: number | null;
  totalEur?: number | null;
  paidEur?: number | null;
  paymentMethod?: string | null;
  lineItems?: CopyLineItem[] | null;
  moveDate?: string | null;
  fromAddress?: string | null;
  toAddress?: string | null;
  toCity?: string | null;
  inventoryNotes?: string | null;
  party?: CopyParty | null;
}

export interface PaymentAccount {
  holder: string;
  iban: string;
  iban_grouped: string;
  bic: string;
}

export interface DocumentRenderCopy {
  legacy_move_wording: boolean;
  invoice_kind: InvoiceKind | null;
  recipient_kind: "person" | "company";
  document_title: string | null;
  subtitle: string | null;
  leistungstitel: string | null;
  leistungsbeschreibung: string | null;
  salutation: string | null;
  intro: string | null;
  closing: string | null;
  omit_service_day_thanks: boolean;
  line_item_title: string | null;
  line_item_description: string | null;
  amount_eur: number | null;
  payment_method: PayMethod | null;
  /** Card-on-site sentence is printed only when this is true. */
  show_card_payment: boolean;
  /** Full payment prose. Null means the template keeps its default block, minus the card sentence when show_card_payment is false. */
  payment_terms: string | null;
  payment_account: PaymentAccount | null;
  due_date: string | null;
  due_date_label: string | null;
  due_date_note: string | null;
  service_date: string | null;
  service_date_label: string | null;
  /** Free-text note, full length. */
  hinweis: string | null;
  gesamthinweis: string | null;
  deposit_deducted_eur: number | null;
  recipient_lines: string[];
  company_name: string | null;
  attention: string | null;
}

const COMPANY_FORM =
  /\b(gmbh|ggmbh|ag|ug|se|kgaa|kg|ohg|gbr|mbh|partg|e\.?\s?v\.?|e\.?\s?kfm\.?|e\.?\s?k\.?|ltd\.?|inc\.?|stiftung|genossenschaft)\b/i;

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] as const;

export function looksLikeCompanyName(name: string | null | undefined): boolean {
  if (!name) return false;
  return COMPANY_FORM.test(name.trim());
}

/** "z. Hd. Thomas Pokorny · Disposition" → "Thomas Pokorny". */
export function attentionFromJobTitle(jobTitle: string | null | undefined): string | null {
  if (!jobTitle) return null;
  const match = jobTitle.match(/z\.?\s*h\.?\s*d\.?\s*([^·,;/]+)/i);
  const name = match?.[1]?.trim();
  return name || null;
}

export function addressLinesFromLocation(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") {
    return value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }
  if (typeof value !== "object") return [];
  const o = value as Record<string, unknown>;
  const line1 =
    (typeof o.line1 === "string" && o.line1.trim()) ||
    (typeof o.street === "string" && o.street.trim()) ||
    "";
  const plz = String(o.postalCode ?? o.postcode ?? o.zip ?? "").trim();
  const city = typeof o.city === "string" ? o.city.trim() : "";
  const lines: string[] = [];
  if (line1) lines.push(line1);
  const cityLine = [plz, city].filter(Boolean).join(" ");
  if (cityLine) lines.push(cityLine);
  return lines;
}

export function formatAddressLine(value: unknown): string | null {
  const lines = addressLinesFromLocation(value);
  if (lines.length === 0) return null;
  return lines.join(", ");
}

export function cityFromLocation(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const city = (value as Record<string, unknown>).city;
  return typeof city === "string" && city.trim() ? city.trim() : null;
}

export function formatDeDate(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return iso;
  return `${match[3]}.${match[2]}.${match[1]}`;
}

export function formatEinsatz(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return iso;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return `${WEEKDAYS[date.getUTCDay()]} ${match[3]}.${match[2]}.${match[1]}`;
}

export function formatEur(amount: number): string {
  const formatted = new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${formatted} €`;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function positive(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readIsoDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const de = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!de) return null;
  return `${de[3]}-${de[2].padStart(2, "0")}-${de[1].padStart(2, "0")}`;
}

function readInvoiceKind(params: Record<string, unknown>, details: Record<string, unknown>): InvoiceKind | null {
  const raw = text(params.invoice_kind) || text(details.invoice_kind) || text(details.invoiceKind);
  return raw === "deposit" || raw === "final" ? raw : null;
}

function readPayMethod(value: unknown): PayMethod | null {
  const raw = text(value);
  if (raw === "bank_transfer" || raw === "paypal" || raw === "cash" || raw === "card") return raw;
  if (raw === "bar" || raw === "karte") return raw === "bar" ? "cash" : "card";
  return null;
}

export function isHouseholdMove(input: {
  serviceType?: string | null;
  showStandardInclusions?: boolean | null;
  summary?: string | null;
  notes?: string | null;
  inventoryNotes?: string | null;
  lineItems?: CopyLineItem[] | null;
}): boolean {
  if (input.serviceType === "kitchen_installation") return false;
  if (input.showStandardInclusions === false) return false;
  if (input.serviceType && input.serviceType !== "move") return false;
  const blob = [
    input.summary,
    input.notes,
    input.inventoryNotes,
    ...(input.lineItems ?? []).map((item) => item.description),
  ]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n");
  if (/kein(?:e|en|er)?\s+haushaltsumzug/i.test(blob)) return false;
  return true;
}

function dueFromNotes(notes: string | null): { iso: string; note: string | null } | null {
  if (!notes) return null;
  const match = notes.match(/fällig[\s\S]{0,80}?(\d{1,2})\.(\d{1,2})\.(\d{4})/i);
  if (!match || match.index == null) return null;
  const iso = `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  const window = notes.slice(match.index, match.index + match[0].length + 40);
  return { iso, note: /vor\s+einsatz/i.test(window) ? "vor Einsatz" : null };
}

function extractRestTerms(notes: string | null): string | null {
  if (!notes) return null;
  const match = notes.match(/(?:Der\s+)?Restbetrag[\s\S]*?(?=\n\s*\n|$)/i);
  return match ? match[0].trim() : null;
}

function extractVariableBilling(notes: string | null): string | null {
  if (!notes) return null;
  const match = notes.match(/Abrechnung variabel:[\s\S]*?(?=\n\s*\n|$)/i);
  return match ? match[0].trim() : null;
}

function groupIban(iban: string): string {
  return iban.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();
}

function paymentAccount(firma: string | null): PaymentAccount | null {
  const bank = firma === "ceylan" ? CEYLAN_BRANDING.bank : KOTTKE_BRANDING.bank;
  if (!bank.iban || !bank.holder) return null;
  return {
    holder: bank.holder,
    iban: bank.iban.replace(/\s+/g, ""),
    iban_grouped: groupIban(bank.iban),
    bic: bank.bic ?? "",
  };
}

function serviceDescription(source: DealDocumentSource, explicit: string | null): string | null {
  if (explicit) return explicit;
  const items = source.lineItems ?? [];
  const priced = items.filter((item) => (item.quantity ?? 0) > 0 && text(item.description));
  const chosen = priced.length > 0 ? priced : items.filter((item) => text(item.description));
  const fromItems = chosen
    .map((item) => text(item.description))
    .filter((line): line is string => !!line)
    .join("\n");
  return fromItems || text(source.inventoryNotes) || text(source.summary);
}

function enrichDescription(
  base: string | null,
  serviceAddress: string | null,
  serviceDate: string | null
): string | null {
  if (!base) return null;
  let next = base.trim();
  const street = serviceAddress?.split(",")[0]?.trim();
  if (serviceAddress && street && !next.toLowerCase().includes(street.toLowerCase())) {
    next += `\n${serviceAddress}`;
  }
  if (serviceDate && !next.includes(formatDeDate(serviceDate))) {
    next += `\nEinsatz: ${formatEinsatz(serviceDate)}.`;
  }
  return next;
}

function shortLabel(summary: string | null, description: string | null): string | null {
  if (summary) {
    const clause = summary.split(/[:\n]/)[0]?.trim() ?? "";
    if (clause.length >= 8 && clause.length <= 120 && !/€|\beur\b|pauschale/i.test(clause)) {
      return clause;
    }
  }
  if (description) {
    const clause = description.split(/[(\n—]/)[0]?.trim() ?? "";
    if (clause.length >= 8 && clause.length <= 120) return clause;
  }
  return null;
}

function withPlaceAndDate(label: string, city: string | null, serviceDate: string | null): string {
  let next = label;
  if (city && !next.toLowerCase().includes(city.toLowerCase())) {
    next += ` · ${city}`;
  }
  if (serviceDate && !next.includes(formatDeDate(serviceDate))) {
    next += ` · ${formatDeDate(serviceDate)}`;
  }
  return next;
}

function accountBlock(account: PaymentAccount | null): string[] {
  if (!account) return [];
  return [
    `Kontoinhaber: ${account.holder}`,
    `IBAN: ${account.iban_grouped}`,
    `BIC: ${account.bic}`,
    "Verwendungszweck: {rechnungsnummer}",
  ];
}

function buildPaymentTerms(input: {
  legacy: boolean;
  explicit: string | null;
  invoiceKind: InvoiceKind | null;
  method: PayMethod | null;
  amountEur: number | null;
  dueLabel: string | null;
  dueNote: string | null;
  notes: string | null;
  depositEur: number | null;
  account: PaymentAccount | null;
  documentType: string;
}): string | null {
  if (input.explicit) return input.explicit;
  // Leave the historical payment paragraph alone on move documents. The
  // template still has to drop the card sentence when show_card_payment is false.
  if (input.legacy) return null;
  if (!input.method) return null;

  const rest = extractRestTerms(input.notes);
  const duePhrase = paymentDuePhrase(input.dueLabel, input.dueNote);

  if (input.method === "card") {
    return "Kartenzahlung direkt vor Ort ist vereinbart.";
  }
  if (input.method === "cash") {
    return input.invoiceKind === "deposit"
      ? "Die Anzahlung wird bar vor Auftragsbeginn entrichtet. Keine Kartenzahlung."
      : "Die Zahlung erfolgt bar. Keine Kartenzahlung vor Ort.";
  }
  if (input.method === "paypal") {
    const lead =
      input.invoiceKind === "deposit" && input.amountEur != null
        ? `Bitte zahlen Sie die Anzahlung von ${formatEur(input.amountEur)} per PayPal${duePhrase}.`
        : "Bitte zahlen Sie den Betrag per PayPal.";
    return `${lead} Keine Kartenzahlung vor Ort.`;
  }

  if (input.invoiceKind === "deposit" && input.amountEur != null) {
    const lines = [
      `Diese Rechnung betrifft die vereinbarte Anzahlung von ${formatEur(input.amountEur)} vor Auftragsbeginn. Bitte überweisen Sie den Betrag${duePhrase} auf folgendes Konto:`,
      ...accountBlock(input.account),
    ];
    lines.push(
      "",
      rest ??
        "Der Restbetrag wird nach dem Auftrag per Überweisung berechnet. Keine Bar-/Kartenzahlung vor Ort."
    );
    return lines.join("\n");
  }

  if (input.documentType !== "RE") {
    if (input.depositEur != null && input.depositEur > 0) {
      return `Die Anzahlung von ${formatEur(input.depositEur)} ist vor Auftragsbeginn per Überweisung zu zahlen. Keine Bar-/Kartenzahlung vor Ort.`;
    }
    return null;
  }

  const lines = [
    "Bitte überweisen Sie den Rechnungsbetrag auf folgendes Konto:",
    ...accountBlock(input.account),
    "",
    "Keine Bar-/Kartenzahlung vor Ort.",
  ];
  return lines.join("\n");
}

function paymentDuePhrase(dueLabel: string | null, dueNote: string | null): string {
  if (!dueLabel) return "";
  const date = dueLabel.split(" (")[0];
  if (dueNote && /einsatz/i.test(dueNote)) return ` bis spätestens ${date} (vor Einsatzbeginn)`;
  if (dueNote) return ` bis spätestens ${date} (${dueNote})`;
  return ` bis spätestens ${date}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildDocumentCopy(
  params: Record<string, unknown>,
  source: DealDocumentSource
): DocumentRenderCopy {
  const details = asRecord(params.document_details);
  const kunde = asRecord(params.kunde);
  const auftrag = asRecord(params.auftrag);
  const preise = asRecord(params.preise);
  const documentType = (text(params.document_type) || "RE").toUpperCase();
  const firma = text(params.firma);

  const serviceType = text(details.serviceType) || text(params.service_type) || source.serviceType || "move";
  const invoiceKind = documentType === "RE" ? readInvoiceKind(params, details) : null;
  const explicitTitle = text(details.leistungstitel) || text(params.leistungstitel);
  const explicitDescription = text(details.leistungsbeschreibung) || text(params.leistungsbeschreibung);
  const explicitSalutation = text(kunde.anrede) || text(details.anrede) || text(params.anrede);
  const explicitTerms = text(params.payment_terms) || text(details.paymentTerms) || text(details.zahlungsbedingungen);
  const explicitAttention = text(kunde.zu_haenden) || text(details.ansprechpartner);
  const anweisung = text(params.anweisung);

  const household = isHouseholdMove({
    serviceType,
    showStandardInclusions: source.showStandardInclusions,
    summary: source.summary,
    notes: source.notes,
    inventoryNotes: source.inventoryNotes,
    lineItems: source.lineItems,
  });
  // Kitchen documents already have their own template branch. Keep that, and
  // keep the historical move body, unless the caller sets a service title or
  // an invoice kind. A due date or payment override does not rewrite the body.
  const legacy = (household || serviceType === "kitchen_installation") && !invoiceKind && !explicitTitle;

  const serviceDate = readIsoDate(auftrag.datum) || readIsoDate(source.moveDate);
  const serviceAddress = text(auftrag.strecke_nach) || source.toAddress || null;
  const city = source.toCity || null;

  const party = source.party;
  const partyFull = text(party?.fullName) || [text(party?.vorname), text(party?.nachname)].filter(Boolean).join(" ");
  const kundeFull = [text(kunde.vorname), text(kunde.nachname)].filter(Boolean).join(" ") || text(kunde.firma);
  const companyName =
    text(kunde.firma) ||
    text(party?.companyName) ||
    (looksLikeCompanyName(partyFull) ? partyFull : null) ||
    (looksLikeCompanyName(kundeFull) ? kundeFull : null);
  const isCompany = !!companyName;
  const attention =
    explicitAttention ||
    text(party?.attention) ||
    attentionFromJobTitle(party?.jobTitle) ||
    null;

  const description = enrichDescription(
    serviceDescription(source, explicitDescription),
    serviceAddress,
    serviceDate
  );
  const derivedTitle = explicitTitle
    ? explicitTitle
    : legacy
      ? null
      : shortLabel(text(source.summary), description);
  const subtitle = derivedTitle
    ? explicitTitle
      ? explicitTitle
      : withPlaceAndDate(derivedTitle, city, serviceDate)
    : null;

  const method =
    readPayMethod(source.paymentMethod) ||
    readPayMethod(preise.zahlungsweg) ||
    readPayMethod(preise.anzahlung_zahlungsweg);
  const cardAgreed = details.cardAgreed === true || params.cardAgreed === true || method === "card";
  const showCard = cardAgreed;

  const depositEur =
    positive(preise.anzahlung_betrag_eur) ||
    (source.depositEur != null ? positive(source.depositEur) : null);
  const totalEur = source.totalEur != null ? positive(source.totalEur) ?? (source.totalEur === 0 ? 0 : null) : null;
  const paidEur = source.paidEur != null && source.paidEur > 0 ? round2(source.paidEur) : 0;

  let amount: number | null = null;
  let deducted: number | null = null;
  if (invoiceKind === "deposit") {
    amount = depositEur;
  } else if (invoiceKind === "final" && totalEur != null) {
    deducted = paidEur > 0 ? round2(Math.min(paidEur, totalEur)) : null;
    amount = round2(Math.max(0, totalEur - paidEur));
  }

  const explicitDue =
    readIsoDate(params.due_date) ||
    readIsoDate(params.faelligkeitsdatum) ||
    readIsoDate(details.faelligkeitsdatum) ||
    readIsoDate(details.dueDate) ||
    readIsoDate(details.depositDue);
  const noted = !explicitDue && invoiceKind === "deposit" ? dueFromNotes(text(source.notes)) : null;
  const dueDate = explicitDue || noted?.iso || null;
  const dueNote =
    text(params.due_date_note) ||
    text(details.faelligkeitshinweis) ||
    noted?.note ||
    (invoiceKind === "deposit" && dueDate && serviceDate && dueDate < serviceDate ? "vor Einsatz" : null);
  const dueLabel = dueDate ? (dueNote ? `${formatDeDate(dueDate)} (${dueNote})` : formatDeDate(dueDate)) : null;

  const account = method === "bank_transfer" ? paymentAccount(firma) : null;
  const paymentTerms = buildPaymentTerms({
    legacy,
    explicit: explicitTerms,
    invoiceKind,
    method,
    amountEur: amount,
    dueLabel,
    dueNote,
    notes: text(source.notes),
    depositEur,
    account,
    documentType,
  });

  let documentTitle: string | null = null;
  let intro: string | null = null;
  let closing: string | null = null;
  let lineTitle: string | null = null;
  let lineDescription: string | null = null;
  const omitThanks = !legacy && (invoiceKind === "deposit" || !household);

  if (!legacy) {
    if (documentType === "KV") documentTitle = "KOSTENVORANSCHLAG";
    else if (documentType === "AB") documentTitle = "AUFTRAGSBESTÄTIGUNG";
    else if (invoiceKind === "deposit") documentTitle = "RECHNUNG — Anzahlung";
    else documentTitle = "RECHNUNG";

    if (invoiceKind === "deposit" && amount != null) {
      intro = `hiermit stellen wir Ihnen die vereinbarte Anzahlung von ${formatEur(amount)} vor Auftragsbeginn in Rechnung. Diese Rechnung betrifft nicht den vollständigen Auftrag.`;
      lineTitle = "Anzahlung vor Auftragsbeginn";
      lineDescription = description;
    } else if (invoiceKind === "final") {
      intro = deducted
        ? `hiermit berechnen wir die vereinbarte Leistung. Die bereits gezahlte Anzahlung von ${formatEur(deducted)} ist abgezogen.`
        : "hiermit berechnen wir die vereinbarte Leistung.";
      lineTitle = subtitle;
      lineDescription = description;
    } else if (documentType === "KV") {
      intro = "hiermit unterbreiten wir Ihnen das folgende Angebot.";
      lineTitle = subtitle;
      lineDescription = description;
    } else if (documentType === "AB") {
      intro = "hiermit bestätigen wir den folgenden Auftrag.";
      lineTitle = subtitle;
      lineDescription = description;
    } else {
      intro = "hiermit berechnen wir die vereinbarte Leistung.";
      lineTitle = subtitle;
      lineDescription = description;
    }

    if (invoiceKind === "final" && household) {
      closing = "Danke für den reibungslosen Ablauf am Umzugstag.";
    }
  }

  const variable = invoiceKind === "deposit" ? extractVariableBilling(text(source.notes)) : null;
  const gesamthinweis = variable
    ? `Hinweis zum Gesamtauftrag (nicht Gegenstand dieser Anzahlungsrechnung): ${variable}`
    : null;

  const addressLines =
    (party?.addressLines ?? []).map((line) => line.trim()).filter(Boolean);
  const recipientLines: string[] = [];
  if (isCompany && companyName) {
    recipientLines.push(companyName);
    if (attention) recipientLines.push(`z. Hd. ${attention}`);
    recipientLines.push(...addressLines);
  }

  const salutation = explicitSalutation || (isCompany ? "Sehr geehrte Damen und Herren" : null);

  return {
    legacy_move_wording: legacy,
    invoice_kind: invoiceKind,
    recipient_kind: isCompany ? "company" : "person",
    document_title: documentTitle,
    subtitle: legacy ? null : subtitle,
    leistungstitel: legacy ? null : subtitle,
    leistungsbeschreibung: legacy ? null : description,
    salutation,
    intro,
    closing,
    omit_service_day_thanks: omitThanks,
    line_item_title: lineTitle,
    line_item_description: lineDescription,
    amount_eur: amount,
    payment_method: method,
    show_card_payment: showCard,
    payment_terms: paymentTerms,
    payment_account: account,
    due_date: dueDate,
    due_date_label: dueLabel,
    due_date_note: dueNote,
    service_date: serviceDate,
    service_date_label: serviceDate ? formatDeDate(serviceDate) : null,
    hinweis: anweisung,
    gesamthinweis,
    deposit_deducted_eur: deducted,
    recipient_lines: recipientLines,
    company_name: isCompany ? companyName : null,
    attention,
  };
}

export function applyDocumentCopy(
  params: Record<string, unknown>,
  source: DealDocumentSource
): Record<string, unknown> {
  const copy = buildDocumentCopy(params, source);
  const next: Record<string, unknown> = { ...params };
  const kunde = { ...asRecord(next.kunde) };
  const auftrag = { ...asRecord(next.auftrag) };
  const details = { ...asRecord(next.document_details) };
  const preise = { ...asRecord(next.preise) };

  if (!text(auftrag.datum) && copy.service_date) auftrag.datum = copy.service_date;
  if (!text(auftrag.strecke_von) && source.fromAddress) auftrag.strecke_von = source.fromAddress;
  if (!text(auftrag.strecke_nach) && source.toAddress) auftrag.strecke_nach = source.toAddress;
  if (!text(auftrag.volumen) && text(source.inventoryNotes)) auftrag.volumen = text(source.inventoryNotes);

  if (copy.recipient_kind === "company" && copy.company_name) {
    kunde.firma = copy.company_name;
    kunde.nachname = copy.company_name;
    kunde.vorname = "";
    if (copy.attention) kunde.zu_haenden = copy.attention;
    if (copy.salutation) kunde.anrede = copy.salutation;
    if (!text(kunde.adresse) && copy.recipient_lines.length > 1) {
      kunde.adresse = copy.recipient_lines.slice(1).join("\n");
    }
  } else if (copy.salutation) {
    kunde.anrede = copy.salutation;
  }
  if (!text(kunde.email) && text(source.party?.email)) kunde.email = text(source.party?.email);

  if (copy.leistungstitel) details.leistungstitel = copy.leistungstitel;
  if (copy.leistungsbeschreibung) details.leistungsbeschreibung = copy.leistungsbeschreibung;
  if (copy.salutation) details.anrede = copy.salutation;
  details.cardAgreed = copy.show_card_payment;
  if (copy.due_date) details.faelligkeitsdatum = copy.due_date;
  if (copy.invoice_kind) details.invoiceKind = copy.invoice_kind;

  if (copy.invoice_kind === "deposit" && copy.amount_eur != null) {
    next.preise = {
      anzahlung_betrag_eur: copy.amount_eur,
      anzahlung_zahlungsweg: preise.anzahlung_zahlungsweg,
      zahlungsstatus: preise.zahlungsstatus,
      zahlungsweg: preise.zahlungsweg,
      modell: "pauschale",
      pauschale_betrag: copy.amount_eur,
      rechnungsbetrag_eur: copy.amount_eur,
      pauschale_positionen: [
        {
          titel: copy.line_item_title,
          beschreibung: copy.line_item_description,
          betrag: copy.amount_eur,
        },
      ],
    };
  } else if (copy.invoice_kind === "final") {
    const positionen = Array.isArray(preise.pauschale_positionen)
      ? [...(preise.pauschale_positionen as unknown[])]
      : [];
    if (copy.deposit_deducted_eur) {
      positionen.push({
        titel: "Abzüglich Anzahlung",
        betrag: -copy.deposit_deducted_eur,
      });
    }
    next.preise = {
      ...preise,
      ...(positionen.length ? { pauschale_positionen: positionen } : {}),
      ...(copy.deposit_deducted_eur
        ? { abzuege: [{ titel: "Abzüglich Anzahlung", betrag: copy.deposit_deducted_eur }] }
        : {}),
      ...(copy.amount_eur != null ? { rechnungsbetrag_eur: copy.amount_eur } : {}),
    };
  } else if (!copy.legacy_move_wording && copy.leistungstitel && Array.isArray(preise.pauschale_positionen)) {
    next.preise = {
      ...preise,
      pauschale_positionen: (preise.pauschale_positionen as Array<Record<string, unknown>>).map((row) =>
        row.titel === "Pauschale"
          ? { ...row, titel: copy.leistungstitel, beschreibung: copy.leistungsbeschreibung ?? row.beschreibung }
          : row
      ),
    };
  }

  if (copy.invoice_kind) next.invoice_kind = copy.invoice_kind;
  if (copy.due_date) next.due_date = copy.due_date;
  if (copy.due_date_note) next.due_date_note = copy.due_date_note;
  if (copy.payment_terms) next.payment_terms = copy.payment_terms;
  next.show_card_payment = copy.show_card_payment;
  // Preserve a caller-supplied note verbatim. Never slice it.
  if (copy.hinweis) next.anweisung = copy.hinweis;

  next.kunde = kunde;
  next.auftrag = auftrag;
  next.document_details = details;
  next.document_copy = copy;
  return next;
}

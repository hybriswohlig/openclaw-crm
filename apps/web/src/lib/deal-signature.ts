/**
 * Pure rules for the customer-portal signature.
 *
 * The portal signs one document: the KV the customer accepted. The stored
 * artifact is the Vertragsmappe (`signed_contract`). An Auftragsbestätigung
 * is not signed separately. A signature covers the live quotation only while
 * that acceptance is still active and the live terms still match the snapshot.
 */
import type { KvaLineItem, KvaSnapshot } from "@openclaw-crm/customer-portal-core";

export const SIGNABLE_DOCUMENT_KINDS = ["kv"] as const;
export const UNSIGNED_DOCUMENT_KINDS = ["ab"] as const;

export type SignatureStatus =
  | "none"
  | "pending"
  | "signed"
  | "superseded"
  | "accepted_without_pdf"
  | "signature_disabled";

export type SignatureArt = "gezeichnet" | "getippt";

export interface SignatureConfirmation {
  id: string;
  superseded: boolean;
  acceptedAt: string;
  /** Set only once the Vertragsmappe is stored. A reservation is not a signature. */
  signedAt: string | null;
  signedByName: string | null;
  signatureArt: SignatureArt | null;
  quotationDocumentId: string | null;
  quotationDocumentSha256: string | null;
  signedDocumentId: string | null;
  signedDocumentSha256: string | null;
  confirmedTotalCents: number;
  snapshot: KvaSnapshot | null;
  moveDate: string | null;
  fromAddress: string | null;
  toAddress: string | null;
}

export interface SignatureViewInput {
  confirmation: SignatureConfirmation | null;
  signatureEnabled: boolean;
  current: KvaSnapshot | null;
  currentQuotationId: string | null;
  currentQuotationUpdatedAt: string | null;
  currentDocumentId: string | null;
  currentDocumentSha256: string | null;
  currentMoveDate: string | null;
  currentFromAddress: string | null;
  currentToAddress: string | null;
}

export interface SignatureView {
  documentKind: "kv";
  status: SignatureStatus;
  /** True only for an active signature whose quotation still matches. */
  coversCurrentTerms: boolean;
  confirmationId: string | null;
  acceptedAt: string | null;
  signedAt: string | null;
  signedByName: string | null;
  signatureArt: SignatureArt | null;
  quotationDocumentId: string | null;
  quotationDocumentSha256: string | null;
  signedDocumentId: string | null;
  signedDocumentSha256: string | null;
  confirmedTotalCents: number | null;
  currentQuotationId: string | null;
  currentQuotationUpdatedAt: string | null;
  currentQuotationDocumentId: string | null;
  currentQuotationDocumentSha256: string | null;
  currentTotalCents: number | null;
  currentQuotationDiffers: boolean;
  differReasons: string[];
}

export function classifySignature(input: {
  confirmation: SignatureConfirmation | null;
  signatureEnabled: boolean;
}): SignatureStatus {
  const row = input.confirmation;
  if (!row) return "none";
  if (row.superseded) return "superseded";
  if (row.signedDocumentId && row.signedAt && row.signedByName) return "signed";
  if (!row.quotationDocumentId) return "accepted_without_pdf";
  if (!input.signatureEnabled) return "signature_disabled";
  return "pending";
}

function normText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(obj[key])}`)
    .join(",")}}`;
}

function lineKey(li: KvaLineItem): string {
  return [li.type, li.description.trim(), li.quantity, Math.round(Number(li.unitRate) * 100)].join("|");
}

/** Why the live quotation is not the one that was accepted or signed. */
export function quotationDifferReasons(input: {
  signed: KvaSnapshot | null;
  current: KvaSnapshot | null;
  signedDocumentSha256: string | null;
  currentDocumentSha256: string | null;
  signedMoveDate: string | null;
  currentMoveDate: string | null;
  signedFromAddress: string | null;
  currentFromAddress: string | null;
  signedToAddress: string | null;
  currentToAddress: string | null;
}): string[] {
  if (!input.signed) return [];
  const reasons: string[] = [];
  const current = input.current;
  if (!current) {
    reasons.push("quotation_missing");
  } else {
    if (input.signed.isVariable !== current.isVariable) reasons.push("variable_price");
    if ((input.signed.fixedPriceCents ?? null) !== (current.fixedPriceCents ?? null)) reasons.push("fixed_price");
    if (input.signed.totalCents !== current.totalCents) reasons.push("total");
    if ((input.signed.depositRequiredCents ?? null) !== (current.depositRequiredCents ?? null)) {
      reasons.push("deposit");
    }
    if ((input.signed.validUntil ?? null) !== (current.validUntil ?? null)) reasons.push("validity");
    if (normText(input.signed.summary) !== normText(current.summary)) reasons.push("summary");
    if (input.signed.showStandardInclusions !== current.showStandardInclusions) reasons.push("inclusions");
    const signedLines = (input.signed.lineItems ?? []).map(lineKey).join("\n");
    const currentLines = (current.lineItems ?? []).map(lineKey).join("\n");
    if (signedLines !== currentLines) reasons.push("line_items");
    if (stable(input.signed.calculationAssumptions ?? null) !== stable(current.calculationAssumptions ?? null)) {
      reasons.push("assumptions");
    }
  }
  if (
    input.signedDocumentSha256 &&
    input.currentDocumentSha256 &&
    input.signedDocumentSha256 !== input.currentDocumentSha256
  ) {
    reasons.push("quotation_pdf");
  }
  if (input.signedMoveDate && normText(input.signedMoveDate) !== normText(input.currentMoveDate)) {
    reasons.push("move_date");
  }
  if (input.signedFromAddress && normText(input.signedFromAddress) !== normText(input.currentFromAddress)) {
    reasons.push("from_address");
  }
  if (input.signedToAddress && normText(input.signedToAddress) !== normText(input.currentToAddress)) {
    reasons.push("to_address");
  }
  return reasons;
}

export function buildSignatureView(input: SignatureViewInput): SignatureView {
  const row = input.confirmation;
  const status = classifySignature({ confirmation: row, signatureEnabled: input.signatureEnabled });
  const differReasons = row
    ? quotationDifferReasons({
        signed: row.snapshot,
        current: input.current,
        signedDocumentSha256: row.quotationDocumentSha256,
        currentDocumentSha256: input.currentDocumentSha256,
        signedMoveDate: row.moveDate,
        currentMoveDate: input.currentMoveDate,
        signedFromAddress: row.fromAddress,
        currentFromAddress: input.currentFromAddress,
        signedToAddress: row.toAddress,
        currentToAddress: input.currentToAddress,
      })
    : [];
  const differs = differReasons.length > 0;
  return {
    documentKind: "kv",
    status,
    coversCurrentTerms: status === "signed" && !differs,
    confirmationId: row?.id ?? null,
    acceptedAt: row?.acceptedAt ?? null,
    signedAt: status === "none" ? null : row?.signedAt ?? null,
    signedByName: row?.signedByName ?? null,
    signatureArt: row?.signatureArt ?? null,
    quotationDocumentId: row?.quotationDocumentId ?? null,
    quotationDocumentSha256: row?.quotationDocumentSha256 ?? null,
    signedDocumentId: row?.signedDocumentId ?? null,
    signedDocumentSha256: row?.signedDocumentSha256 ?? null,
    confirmedTotalCents: row?.confirmedTotalCents ?? null,
    currentQuotationId: input.currentQuotationId,
    currentQuotationUpdatedAt: input.currentQuotationUpdatedAt,
    currentQuotationDocumentId: input.currentDocumentId,
    currentQuotationDocumentSha256: input.currentDocumentSha256,
    currentTotalCents: input.current?.totalCents ?? null,
    currentQuotationDiffers: differs,
    differReasons,
  };
}

/** A completed signature is the name plus the stored Vertragsmappe, not a reservation. */
export function completedSignature(row: {
  unterschriftAt: Date | null;
  unterschriftName: string | null;
  unterschriftArt: string | null;
  vertragDocumentId: string | null;
}): { at: string; name: string; art: SignatureArt } | null {
  if (!row.unterschriftAt || !row.unterschriftName || !row.vertragDocumentId) return null;
  return {
    at: row.unterschriftAt.toISOString(),
    name: row.unterschriftName,
    art: row.unterschriftArt === "gezeichnet" ? "gezeichnet" : "getippt",
  };
}

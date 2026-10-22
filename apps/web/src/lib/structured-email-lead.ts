/**
 * Turns a parsed portal mail into the contact, thread and deal the ingest
 * should create. Null when the mail is not a structured lead.
 */

import { computeLeadName } from "@/services/lead-name";
import {
  isFormspreeEmail,
  formspreeContactEmail,
  formspreeThreadKey,
  parseFormspreeEmail,
  type FormspreeLead,
} from "@/services/inbox-formspree";
import {
  isMoebeltransportSender,
  moebeltransportContactEmail,
  parseMoebeltransportLeadEmail,
  type AddressParts,
  type MoebeltransportLead,
} from "@/services/inbox-moebeltransport";

export interface StructuredMovingFacts {
  moveDate: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  fromLocation: AddressParts | null;
  toLocation: AddressParts | null;
  notes: string;
}

export interface StructuredEmailPlan {
  kind: "moebeltransport24" | "formspree";
  threadKey: string;
  contactEmail: string;
  contactName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  leadSource: string;
  sourceChannel: "Möbeltransport24" | "Website-Formular";
  sourceDetail: string | null;
  dealName: string;
  moving: StructuredMovingFacts;
}

export function planStructuredEmailLead(input: {
  from: string;
  subject: string;
  body: string;
  messageId: string;
  replyTo?: string | null;
  headers?: Record<string, unknown> | null;
}): StructuredEmailPlan | null {
  const mt24 = parseMoebeltransportLeadEmail(input.subject, input.body, input.from);
  if (mt24) return planMoebeltransport(mt24);
  const form = parseFormspreeEmail({
    from: input.from,
    subject: input.subject,
    body: input.body,
    replyTo: input.replyTo,
    headers: input.headers,
  });
  if (form) return planFormspree(form, input.messageId);
  return null;
}

/** Portal envelopes must not arm an auto-reply to a noreply address. */
export function isPortalEnvelope(input: {
  from: string;
  subject?: string | null;
  body?: string | null;
  headers?: Record<string, unknown> | null;
}): boolean {
  return (
    isMoebeltransportSender(input.from) ||
    isFormspreeEmail({
      from: input.from,
      subject: input.subject,
      body: input.body,
      headers: input.headers,
    })
  );
}

function planMoebeltransport(lead: MoebeltransportLead): StructuredEmailPlan {
  const name = lead.customer.fullName || lead.customer.email || `Anfrage ${lead.inquiryId}`;
  return {
    kind: "moebeltransport24",
    threadKey: `mt24:${lead.inquiryId}`,
    contactEmail: moebeltransportContactEmail(lead),
    contactName: name,
    customerEmail: lead.customer.email,
    customerPhone: lead.customer.phone,
    leadSource: "Möbeltransport24",
    sourceChannel: "Möbeltransport24",
    sourceDetail: lead.inquiryId,
    dealName: computeLeadName({
      customerName: name,
      fromAddress: lead.fromAddress,
      toAddress: lead.toAddress,
      moveDate: lead.moveDate,
    }),
    moving: facts({
      moveDate: lead.moveDate,
      fromAddress: lead.fromAddress,
      toAddress: lead.toAddress,
      fromLocation: lead.fromLocation,
      toLocation: lead.toLocation,
      details: lead.details,
      phone: lead.customer.phone,
      email: lead.customer.email,
    }),
  };
}

function planFormspree(lead: FormspreeLead, messageId: string): StructuredEmailPlan {
  const name = lead.customer.fullName || lead.customer.email || "Website-Anfrage";
  return {
    kind: "formspree",
    threadKey: formspreeThreadKey(lead, messageId),
    contactEmail: formspreeContactEmail(lead, messageId),
    contactName: name,
    customerEmail: lead.customer.email,
    customerPhone: lead.customer.phone,
    leadSource: "Website",
    sourceChannel: "Website-Formular",
    sourceDetail: null,
    dealName: computeLeadName({
      customerName: name,
      fromAddress: lead.fromAddress,
      toAddress: lead.toAddress,
      moveDate: lead.moveDate,
    }),
    moving: facts({
      moveDate: lead.moveDate,
      fromAddress: lead.fromAddress,
      toAddress: lead.toAddress,
      fromLocation: lead.fromLocation,
      toLocation: lead.toLocation,
      details: lead.message,
      phone: lead.customer.phone,
      email: lead.customer.email,
    }),
  };
}

function facts(input: {
  moveDate: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  fromLocation: AddressParts | null;
  toLocation: AddressParts | null;
  details: string | null;
  phone: string | null;
  email: string | null;
}): StructuredMovingFacts {
  const lines = [
    input.details,
    input.fromAddress ? `Von: ${input.fromAddress.replace(/\s*\n\s*/g, ", ")}` : null,
    input.toAddress ? `Nach: ${input.toAddress.replace(/\s*\n\s*/g, ", ")}` : null,
    input.phone ? `Telefon: ${input.phone}` : null,
    input.email ? `E-Mail: ${input.email}` : null,
  ].filter((line): line is string => !!line);
  return {
    moveDate: input.moveDate,
    fromAddress: input.fromAddress,
    toAddress: input.toAddress,
    fromLocation: input.fromLocation,
    toLocation: input.toLocation,
    notes: lines.join("\n"),
  };
}

/**
 * Authoritative customer name for AB/RE/Anweisung PDFs.
 *
 * The browser may send a stale or lead-title-based `kunde` payload (e.g.
 * "Kyra Heiker — Weil der Stadt → Weil der Stadt" split into vorname/nachname).
 * Callers that forward to crm-tools MUST rewrite kunde via this module so the
 * linked person wins and lead-title decorations never reach the PDF.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { objects, attributes } from "@/db/schema/objects";
import { recordValues } from "@/db/schema/records";
import {
  resolveCustomerNameForDocs,
  stripLeadTitleDecorations,
  type LeadContext,
} from "@/lib/deal-doc-data";

export interface DocCustomerName {
  vorname?: string;
  nachname: string;
  /** Full display string for logs / labels. */
  fullName: string;
  source: "person" | "lead_title";
}

/**
 * Resolve the real customer name for a deal, preferring associated_people.
 * Safe to call from API routes; returns null if nothing usable is found.
 */
export async function resolveDocCustomerName(
  workspaceId: string,
  dealRecordId: string
): Promise<DocCustomerName | null> {
  const [dealObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  if (!dealObj) return null;

  const attrRows = await db
    .select({ id: attributes.id, slug: attributes.slug })
    .from(attributes)
    .where(eq(attributes.objectId, dealObj.id));
  const bySlug = new Map(attrRows.map((a) => [a.slug, a.id]));

  const nameAttrId = bySlug.get("name");
  const peopleAttrId = bySlug.get("associated_people");

  let leadTitle: string | null = null;
  if (nameAttrId) {
    const [row] = await db
      .select({ textValue: recordValues.textValue })
      .from(recordValues)
      .where(
        and(eq(recordValues.recordId, dealRecordId), eq(recordValues.attributeId, nameAttrId))
      )
      .limit(1);
    leadTitle = row?.textValue?.trim() || null;
  }

  let personFull: string | null = null;
  let personVor: string | null = null;
  let personNach: string | null = null;

  if (peopleAttrId) {
    // Multiselect: one row per linked person — take the first.
    const [link] = await db
      .select({ personId: recordValues.referencedRecordId })
      .from(recordValues)
      .where(
        and(
          eq(recordValues.recordId, dealRecordId),
          eq(recordValues.attributeId, peopleAttrId)
        )
      )
      .limit(1);
    if (link?.personId) {
      const loaded = await loadPersonNameParts(link.personId);
      personFull = loaded.fullName;
      personVor = loaded.vorname;
      personNach = loaded.nachname;
    }
  }

  const ctx: LeadContext = {
    name: leadTitle,
    person_name: personFull,
    person_vorname: personVor,
    person_nachname: personNach,
    move_date: null,
    move_from_address: null,
    move_to_address: null,
    floors_from: null,
    floors_to: null,
    elevator_from: null,
    elevator_to: null,
    inventory_notes: null,
    operating_company: null,
  };

  const resolved = resolveCustomerNameForDocs(ctx);
  if (!resolved) return null;

  const fullName = [resolved.vorname, resolved.nachname].filter(Boolean).join(" ");
  const source: DocCustomerName["source"] =
    personFull || personNach || personVor ? "person" : "lead_title";

  return {
    vorname: resolved.vorname,
    nachname: resolved.nachname,
    fullName,
    source,
  };
}

/**
 * Overwrite params.kunde.vorname/nachname with the authoritative deal customer
 * name. Keeps adresse/email and other kunde fields intact.
 */
export async function rewriteKundeParamsFromDeal(
  workspaceId: string,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const dealId =
    typeof params._deal_record_id === "string" ? params._deal_record_id : null;
  if (!dealId) return params;

  const resolved = await resolveDocCustomerName(workspaceId, dealId);
  if (!resolved) {
    // Still sanitize whatever the client sent if it looks like a lead title.
    return sanitizeKundeInParams(params);
  }

  const prev = (params.kunde && typeof params.kunde === "object"
    ? (params.kunde as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  return {
    ...params,
    kunde: {
      ...prev,
      vorname: resolved.vorname,
      nachname: resolved.nachname,
    },
  };
}

/** Best-effort clean of client-supplied kunde when no deal id is available. */
function sanitizeKundeInParams(params: Record<string, unknown>): Record<string, unknown> {
  const prev = (params.kunde && typeof params.kunde === "object"
    ? (params.kunde as Record<string, unknown>)
    : null) as Record<string, unknown> | null;
  if (!prev) return params;

  const full = [prev.vorname, prev.nachname].filter((x) => typeof x === "string" && x.trim()).join(" ");
  const cleaned = stripLeadTitleDecorations(full);
  if (!cleaned || cleaned === full) return params;

  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return params;
  const nachname = parts[parts.length - 1];
  const vorname = parts.length > 1 ? parts.slice(0, -1).join(" ") : undefined;
  return {
    ...params,
    kunde: { ...prev, vorname, nachname },
  };
}

async function loadPersonNameParts(personRecordId: string): Promise<{
  fullName: string | null;
  vorname: string | null;
  nachname: string | null;
}> {
  const empty = { fullName: null, vorname: null, nachname: null };
  const [nameRow] = await db
    .select({
      textValue: recordValues.textValue,
      jsonValue: recordValues.jsonValue,
    })
    .from(recordValues)
    .innerJoin(attributes, eq(attributes.id, recordValues.attributeId))
    .where(
      and(eq(recordValues.recordId, personRecordId), eq(attributes.slug, "name"))
    )
    .limit(1);

  if (!nameRow) return empty;

  if (nameRow.jsonValue && typeof nameRow.jsonValue === "object") {
    const pn = nameRow.jsonValue as Record<string, unknown>;
    let vorname =
      (typeof pn.firstName === "string" && pn.firstName.trim()) ||
      (typeof pn.first_name === "string" && pn.first_name.trim()) ||
      null;
    let nachname =
      (typeof pn.lastName === "string" && pn.lastName.trim()) ||
      (typeof pn.last_name === "string" && pn.last_name.trim()) ||
      null;
    let fullName =
      (typeof pn.fullName === "string" && pn.fullName.trim()) ||
      [vorname, nachname].filter(Boolean).join(" ") ||
      null;

    // Person records sometimes got the lead title copied in; strip decorations.
    if (fullName) {
      const cleaned = stripLeadTitleDecorations(fullName);
      if (cleaned && cleaned !== fullName) {
        fullName = cleaned;
        const parts = cleaned.split(/\s+/).filter(Boolean);
        nachname = parts.length > 0 ? parts[parts.length - 1] : nachname;
        vorname = parts.length > 1 ? parts.slice(0, -1).join(" ") : null;
      }
    }
    if (vorname && /[—–→]/.test(vorname)) {
      const cleaned = stripLeadTitleDecorations(
        [vorname, nachname].filter(Boolean).join(" ")
      );
      if (cleaned) {
        fullName = cleaned;
        const parts = cleaned.split(/\s+/).filter(Boolean);
        nachname = parts.length > 0 ? parts[parts.length - 1] : null;
        vorname = parts.length > 1 ? parts.slice(0, -1).join(" ") : null;
      }
    }

    if (fullName || vorname || nachname) {
      return {
        fullName: fullName || null,
        vorname: vorname || null,
        nachname: nachname || null,
      };
    }
  }

  const text = nameRow.textValue?.trim() || null;
  if (!text) return empty;
  const cleaned = stripLeadTitleDecorations(text) || text;
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return {
    fullName: cleaned,
    vorname: parts.length > 1 ? parts.slice(0, -1).join(" ") : null,
    nachname: parts.length > 0 ? parts[parts.length - 1] : null,
  };
}

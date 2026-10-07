/**
 * Deal + linked person/company fields used to fill KV/AB/RE params.
 * The quotation itself is loaded separately (prices, notes, payment method).
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { attributes } from "@/db/schema/objects";
import { recordValues } from "@/db/schema/records";
import {
  addressLinesFromLocation,
  cityFromLocation,
  formatAddressLine,
  looksLikeCompanyName,
  type CopyParty,
} from "@/services/document-copy";

export interface DealRenderContext {
  party: CopyParty | null;
  moveDate: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  toCity: string | null;
  inventoryNotes: string | null;
}

interface ValueRow {
  slug: string;
  textValue: string | null;
  dateValue: string | Date | null;
  jsonValue: unknown;
  referencedRecordId: string | null;
}

const EMPTY: DealRenderContext = {
  party: null,
  moveDate: null,
  fromAddress: null,
  toAddress: null,
  toCity: null,
  inventoryNotes: null,
};

export async function loadDealRenderContext(dealRecordId: string): Promise<DealRenderContext> {
  const dealRows = await valuesFor(dealRecordId, [
    "move_date",
    "move_from_address",
    "move_to_address",
    "inventory_notes",
    "company",
    "associated_people",
  ]);
  if (dealRows.length === 0) return EMPTY;

  const bySlug = group(dealRows);
  const personId = bySlug.get("associated_people")?.find((row) => row.referencedRecordId)?.referencedRecordId;
  const companyId = bySlug.get("company")?.find((row) => row.referencedRecordId)?.referencedRecordId;

  const [personRows, companyRows] = await Promise.all([
    personId
      ? valuesFor(personId, ["name", "job_title", "location", "email_addresses", "description"])
      : Promise.resolve([] as ValueRow[]),
    companyId ? valuesFor(companyId, ["name", "primary_location"]) : Promise.resolve([] as ValueRow[]),
  ]);

  const person = group(personRows);
  const company = group(companyRows);
  const name = readPersonName(person.get("name")?.[0]);
  const companyName = textOf(company.get("name")?.[0]);
  const jobTitle = textOf(person.get("job_title")?.[0]);
  const personLocation = person.get("location")?.[0]?.jsonValue ?? null;
  const companyLocation = company.get("primary_location")?.[0]?.jsonValue ?? null;
  const personIsCompany = looksLikeCompanyName(name.full);
  const billingLocation = personIsCompany ? personLocation || companyLocation : companyLocation || personLocation;

  const party: CopyParty | null =
    name.full || companyName
      ? {
          fullName: name.full,
          vorname: name.vor,
          nachname: name.nach,
          companyName: companyName || (personIsCompany ? name.full : null),
          jobTitle,
          addressLines: addressLinesFromLocation(billingLocation),
          email: readEmail(person.get("email_addresses") ?? []),
        }
      : null;

  const toValue = bySlug.get("move_to_address")?.[0]?.jsonValue ?? null;
  const fromValue = bySlug.get("move_from_address")?.[0]?.jsonValue ?? null;

  return {
    party,
    moveDate: isoDate(bySlug.get("move_date")?.[0]),
    fromAddress: formatAddressLine(fromValue),
    toAddress: formatAddressLine(toValue),
    toCity: cityFromLocation(toValue),
    inventoryNotes: textOf(bySlug.get("inventory_notes")?.[0]),
  };
}

async function valuesFor(recordId: string, slugs: string[]): Promise<ValueRow[]> {
  return db
    .select({
      slug: attributes.slug,
      textValue: recordValues.textValue,
      dateValue: recordValues.dateValue,
      jsonValue: recordValues.jsonValue,
      referencedRecordId: recordValues.referencedRecordId,
    })
    .from(recordValues)
    .innerJoin(attributes, eq(attributes.id, recordValues.attributeId))
    .where(and(eq(recordValues.recordId, recordId), inArray(attributes.slug, slugs)));
}

function group(rows: ValueRow[]): Map<string, ValueRow[]> {
  const map = new Map<string, ValueRow[]>();
  for (const row of rows) {
    const list = map.get(row.slug) ?? [];
    list.push(row);
    map.set(row.slug, list);
  }
  return map;
}

function textOf(row: ValueRow | undefined): string | null {
  const value = row?.textValue?.trim();
  return value || null;
}

function isoDate(row: ValueRow | undefined): string | null {
  const raw = row?.dateValue ?? row?.textValue ?? null;
  if (!raw) return null;
  if (typeof raw === "string") return raw.slice(0, 10);
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  return null;
}

function readPersonName(row: ValueRow | undefined): { full: string | null; vor: string | null; nach: string | null } {
  const empty = { full: null, vor: null, nach: null };
  if (!row) return empty;
  const json = row.jsonValue;
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const pn = json as Record<string, unknown>;
    const vor =
      (typeof pn.firstName === "string" && pn.firstName.trim()) ||
      (typeof pn.first_name === "string" && pn.first_name.trim()) ||
      null;
    const nach =
      (typeof pn.lastName === "string" && pn.lastName.trim()) ||
      (typeof pn.last_name === "string" && pn.last_name.trim()) ||
      null;
    const full =
      (typeof pn.fullName === "string" && pn.fullName.trim()) ||
      (typeof pn.full_name === "string" && pn.full_name.trim()) ||
      [vor, nach].filter(Boolean).join(" ") ||
      null;
    return { full, vor, nach };
  }
  const text = row.textValue?.trim() || null;
  if (!text) return empty;
  const parts = text.split(/\s+/).filter(Boolean);
  return {
    full: text,
    vor: parts.length > 1 ? parts.slice(0, -1).join(" ") : null,
    nach: parts.length > 0 ? parts[parts.length - 1] : null,
  };
}

function readEmail(rows: ValueRow[]): string | null {
  for (const row of rows) {
    if (row.textValue?.includes("@")) return row.textValue.trim();
    const json = row.jsonValue;
    if (typeof json === "string" && json.includes("@")) return json.trim();
    if (Array.isArray(json)) {
      const found = json.find((item) => typeof item === "string" && item.includes("@"));
      if (typeof found === "string") return found.trim();
    }
  }
  return null;
}

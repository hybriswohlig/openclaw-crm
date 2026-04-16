/**
 * Auto-creates CRM "people" records for inbox contacts.
 *
 * Called during message ingest (both email and WhatsApp paths) so that
 * every external contact who reaches out automatically gets a Person in
 * the CRM, not just a lightweight inboxContacts row.
 *
 * Deduplication: before creating a new record, searches existing people
 * by email or phone. If a match is found, the inbox contact is linked to
 * the existing record and any missing contact fields are added.
 *
 * Failures are logged but never thrown — CRM record creation must never
 * block message ingest.
 */

import { db } from "@/db";
import { inboxContacts } from "@/db/schema/inbox";
import { objects, attributes, selectOptions } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import { eq, and } from "drizzle-orm";
import { createRecord, updateRecord } from "./records";

/**
 * Ensure the given inbox contact has a corresponding CRM "people" record.
 * Idempotent: if `crmRecordId` is already set, returns it immediately.
 *
 * Dedup: searches existing people records by email or phone before
 * creating a new one. If found, links to the existing record and
 * enriches it with any new contact fields (phone from WA, email from KA).
 *
 * @returns The CRM record ID, or null if creation was skipped / failed.
 */
export async function ensureCrmPerson(params: {
  workspaceId: string;
  contactId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  leadSource: "WhatsApp / Website" | "Kleinanzeigen";
}): Promise<string | null> {
  const { workspaceId, contactId, displayName, email, phone, leadSource } = params;
  try {
    // 1. Check if already linked — idempotent guard.
    const [contact] = await db
      .select({ crmRecordId: inboxContacts.crmRecordId })
      .from(inboxContacts)
      .where(eq(inboxContacts.id, contactId))
      .limit(1);

    if (contact?.crmRecordId) return contact.crmRecordId;

    // 2. Resolve the workspace's "people" object.
    const [peopleObj] = await db
      .select({ id: objects.id })
      .from(objects)
      .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "people")))
      .limit(1);
    if (!peopleObj) {
      console.warn(`[inbox-crm-link] no people object for workspace ${workspaceId}`);
      return null;
    }

    // 3. Resolve relevant attributes.
    const attrRows = await db
      .select({ id: attributes.id, slug: attributes.slug })
      .from(attributes)
      .where(eq(attributes.objectId, peopleObj.id));
    const attrBySlug = new Map(attrRows.map((a) => [a.slug, a.id]));

    // 4. Dedup: search for an existing people record with matching email or phone.
    const existingRecordId = await findExistingPerson(
      peopleObj.id,
      email,
      phone,
      attrBySlug.get("email_addresses") ?? null,
      attrBySlug.get("phone_numbers") ?? null
    );

    if (existingRecordId) {
      // Link this inbox contact to the existing person.
      await db
        .update(inboxContacts)
        .set({ crmRecordId: existingRecordId, updatedAt: new Date() })
        .where(eq(inboxContacts.id, contactId));

      // Enrich: add any missing contact fields to the existing person.
      const enrichUpdates: Record<string, unknown> = {};
      if (email && attrBySlug.get("email_addresses")) {
        const hasEmail = await hasAttributeValue(
          existingRecordId, attrBySlug.get("email_addresses")!, email
        );
        if (!hasEmail) enrichUpdates.email_addresses = email;
      }
      if (phone && attrBySlug.get("phone_numbers")) {
        const hasPhone = await hasAttributeValue(
          existingRecordId, attrBySlug.get("phone_numbers")!, phone
        );
        if (!hasPhone) enrichUpdates.phone_numbers = phone;
      }
      if (Object.keys(enrichUpdates).length > 0) {
        await updateRecord(peopleObj.id, existingRecordId, enrichUpdates, null);
      }

      return existingRecordId;
    }

    // 5. Resolve lead_source select option.
    let leadSourceOptionId: string | null = null;
    const leadSourceAttrId = attrBySlug.get("lead_source");
    if (leadSourceAttrId) {
      const options = await db
        .select({ id: selectOptions.id, title: selectOptions.title })
        .from(selectOptions)
        .where(eq(selectOptions.attributeId, leadSourceAttrId));
      const match = options.find((o) => o.title === leadSource);
      leadSourceOptionId = match?.id ?? null;
    }

    // 6. Parse display name into personal_name JSON.
    const nameParts = parsePersonalName(displayName);

    // 7. Build the CRM record input.
    const input: Record<string, unknown> = {
      name: nameParts,
    };
    if (email) input.email_addresses = email;
    if (phone) input.phone_numbers = phone;
    if (leadSourceOptionId) input.lead_source = leadSourceOptionId;

    // 8. Create the CRM people record.
    const record = await createRecord(peopleObj.id, input, null);
    if (!record) {
      console.warn(`[inbox-crm-link] createRecord returned null for contact ${contactId}`);
      return null;
    }

    // 9. Link the inbox contact to the new CRM record.
    await db
      .update(inboxContacts)
      .set({ crmRecordId: record.id, updatedAt: new Date() })
      .where(eq(inboxContacts.id, contactId));

    return record.id;
  } catch (err) {
    console.error("[inbox-crm-link] ensureCrmPerson failed:", err);
    return null;
  }
}

/**
 * Search for an existing CRM people record that has a matching email
 * or phone stored in its record_values.
 */
async function findExistingPerson(
  peopleObjectId: string,
  email: string | null,
  phone: string | null,
  emailAttrId: string | null,
  phoneAttrId: string | null
): Promise<string | null> {
  // Try email first (more reliable identifier).
  if (email && emailAttrId) {
    const [match] = await db
      .select({ recordId: recordValues.recordId })
      .from(recordValues)
      .innerJoin(records, eq(records.id, recordValues.recordId))
      .where(
        and(
          eq(records.objectId, peopleObjectId),
          eq(recordValues.attributeId, emailAttrId),
          eq(recordValues.textValue, email)
        )
      )
      .limit(1);
    if (match) return match.recordId;
  }

  // Fallback to phone.
  if (phone && phoneAttrId) {
    const [match] = await db
      .select({ recordId: recordValues.recordId })
      .from(recordValues)
      .innerJoin(records, eq(records.id, recordValues.recordId))
      .where(
        and(
          eq(records.objectId, peopleObjectId),
          eq(recordValues.attributeId, phoneAttrId),
          eq(recordValues.textValue, phone)
        )
      )
      .limit(1);
    if (match) return match.recordId;
  }

  return null;
}

/**
 * Check if a record already has a specific text value for an attribute
 * (used to avoid adding duplicate emails/phones during enrichment).
 */
async function hasAttributeValue(
  recordId: string,
  attributeId: string,
  value: string
): Promise<boolean> {
  const [existing] = await db
    .select({ id: recordValues.id })
    .from(recordValues)
    .where(
      and(
        eq(recordValues.recordId, recordId),
        eq(recordValues.attributeId, attributeId),
        eq(recordValues.textValue, value)
      )
    )
    .limit(1);
  return !!existing;
}

/**
 * Parse a display name string into the personal_name JSON format:
 * `{ first_name, last_name, full_name }`.
 */
function parsePersonalName(displayName: string): {
  first_name: string;
  last_name: string;
  full_name: string;
} {
  const trimmed = (displayName || "").trim();
  if (!trimmed) {
    return { first_name: "", last_name: "", full_name: "" };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return { first_name: parts[0], last_name: "", full_name: trimmed };
  }
  const firstName = parts[0];
  const lastName = parts.slice(1).join(" ");
  return { first_name: firstName, last_name: lastName, full_name: trimmed };
}

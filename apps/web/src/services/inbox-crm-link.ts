/**
 * Auto-creates CRM "people" records for inbox contacts.
 *
 * Called during message ingest (both email and WhatsApp paths) so that
 * every external contact who reaches out automatically gets a Person in
 * the CRM, not just a lightweight inboxContacts row.
 *
 * Failures are logged but never thrown — CRM record creation must never
 * block message ingest.
 */

import { db } from "@/db";
import { inboxContacts } from "@/db/schema/inbox";
import { objects, attributes, selectOptions } from "@/db/schema/objects";
import { eq, and } from "drizzle-orm";
import { createRecord } from "./records";

/**
 * Ensure the given inbox contact has a corresponding CRM "people" record.
 * Idempotent: if `crmRecordId` is already set, returns it immediately.
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

    // 3. Resolve lead_source attribute + find the matching select option.
    let leadSourceOptionId: string | null = null;
    const [leadSourceAttr] = await db
      .select({ id: attributes.id })
      .from(attributes)
      .where(and(eq(attributes.objectId, peopleObj.id), eq(attributes.slug, "lead_source")))
      .limit(1);

    if (leadSourceAttr) {
      const options = await db
        .select({ id: selectOptions.id, title: selectOptions.title })
        .from(selectOptions)
        .where(eq(selectOptions.attributeId, leadSourceAttr.id));

      const match = options.find((o) => o.title === leadSource);
      leadSourceOptionId = match?.id ?? null;
    }

    // 4. Parse display name into personal_name JSON.
    const nameParts = parsePersonalName(displayName);

    // 5. Build the CRM record input.
    const input: Record<string, unknown> = {
      name: nameParts,
    };
    if (email) input.email_addresses = email;
    if (phone) input.phone_numbers = phone;
    if (leadSourceOptionId) input.lead_source = leadSourceOptionId;

    // 6. Create the CRM people record.
    const record = await createRecord(peopleObj.id, input, null);
    if (!record) {
      console.warn(`[inbox-crm-link] createRecord returned null for contact ${contactId}`);
      return null;
    }

    // 7. Link the inbox contact to the new CRM record.
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

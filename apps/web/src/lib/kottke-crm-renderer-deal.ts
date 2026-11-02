import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { attributes, objects } from "@/db/schema/objects";
import { recordValues } from "@/db/schema/records";
import {
  KOTTKE_OPERATING_COMPANY_ID,
  blocksInRepoCrmRenderer,
} from "@/lib/kottke-crm-renderer";

/**
 * The deal's operating company is Kottke, so the in-repo CRM renderer
 * must not run. Missing company is not Kottke: Ceylan and every other
 * firm stay on the existing path.
 */
export async function dealBlocksInRepoCrmRenderer(
  workspaceId: string,
  dealRecordId: string
): Promise<boolean> {
  if (!dealRecordId) return false;

  const [dealObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  if (!dealObj) return false;

  const [opAttr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(
      and(eq(attributes.objectId, dealObj.id), eq(attributes.slug, "operating_company"))
    )
    .limit(1);
  if (!opAttr) return false;

  const [val] = await db
    .select({ referencedRecordId: recordValues.referencedRecordId })
    .from(recordValues)
    .where(
      and(eq(recordValues.recordId, dealRecordId), eq(recordValues.attributeId, opAttr.id))
    )
    .limit(1);
  const ocId = val?.referencedRecordId ?? null;
  if (!ocId) return false;
  if (ocId.toLowerCase() === KOTTKE_OPERATING_COMPANY_ID) return true;

  const [nameAttr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .innerJoin(objects, eq(objects.id, attributes.objectId))
    .where(
      and(
        eq(objects.workspaceId, workspaceId),
        eq(objects.slug, "operating_companies"),
        eq(attributes.slug, "name")
      )
    )
    .limit(1);
  if (!nameAttr) return false;

  const [nameRow] = await db
    .select({ name: recordValues.textValue })
    .from(recordValues)
    .where(
      and(eq(recordValues.recordId, ocId), eq(recordValues.attributeId, nameAttr.id))
    )
    .limit(1);

  return blocksInRepoCrmRenderer({ operatingCompanyName: nameRow?.name });
}

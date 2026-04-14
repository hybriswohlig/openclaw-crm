import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, badRequest, success } from "@/lib/api-utils";
import { getObjectBySlug } from "@/services/objects";
import { listRecords, createRecord } from "@/services/records";
import { db } from "@/db";
import { attributes, statuses } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { slug } = await params;
  const obj = await getObjectBySlug(ctx.workspaceId, slug);
  if (!obj) return notFound("Object not found");

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") || 50), 200);
  const offset = Number(searchParams.get("offset") || 0);

  const result = await listRecords(obj.id, { limit, offset });

  return success({
    records: result.records,
    pagination: { limit, offset, total: result.total },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { slug } = await params;
  const obj = await getObjectBySlug(ctx.workspaceId, slug);
  if (!obj) return notFound("Object not found");

  const body = await req.json();
  const { values } = body;

  if (!values || typeof values !== "object") {
    return badRequest("values object is required");
  }

  const record = await createRecord(obj.id, values, ctx.userId);

  // When a Company is created, auto-create a linked Lead in "New Lead" stage
  // so the sales team lands it directly on the pipeline and can fill in the
  // remaining details from there.
  if (slug === "companies" && record) {
    try {
      await autoCreateNewLead(ctx.workspaceId, record.id, values, ctx.userId);
    } catch (err) {
      console.error("[companies] auto-create lead failed", err);
    }
  }

  return success(record, 201);
}

/**
 * Create a lead record in the "New Lead" stage linked to the given company.
 * Best-effort — any failure is logged and swallowed so the company create
 * still succeeds.
 */
async function autoCreateNewLead(
  workspaceId: string,
  companyRecordId: string,
  companyValues: Record<string, unknown>,
  userId: string
) {
  const dealsObj = await getObjectBySlug(workspaceId, "deals");
  if (!dealsObj) return;

  // Find the stage attribute and look up the "New Lead" status id
  const [stageAttr] = await db
    .select()
    .from(attributes)
    .where(and(eq(attributes.objectId, dealsObj.id), eq(attributes.slug, "stage")))
    .limit(1);
  if (!stageAttr) return;

  const [newLeadStatus] = await db
    .select()
    .from(statuses)
    .where(and(eq(statuses.attributeId, stageAttr.id), eq(statuses.title, "New Lead")))
    .limit(1);
  if (!newLeadStatus) return;

  // Derive a name for the lead from the company name
  const companyName =
    typeof companyValues.name === "string" && companyValues.name.trim()
      ? companyValues.name.trim()
      : "New Company";

  const leadValues: Record<string, unknown> = {
    name: `${companyName} — New Lead`,
    stage: newLeadStatus.id,
    company: companyRecordId,
  };

  // Inherit country if the company has one and the deals object also has a
  // country attribute with a matching option title.
  const companyCountryOptionId = companyValues.country;
  if (typeof companyCountryOptionId === "string" && companyCountryOptionId) {
    const inherited = await resolveInheritedCountry(
      workspaceId,
      companyCountryOptionId,
      dealsObj.id
    );
    if (inherited) leadValues.country = inherited;
  }

  await createRecord(dealsObj.id, leadValues, userId);
}

/**
 * The `country` select attribute exists on both companies and deals with the
 * same set of option titles, but the option IDs differ because each attribute
 * has its own option rows. Resolve by title.
 */
async function resolveInheritedCountry(
  workspaceId: string,
  companyCountryOptionId: string,
  dealsObjectId: string
): Promise<string | null> {
  // Look up the title of the company's country option
  const { selectOptions } = await import("@/db/schema");

  const [companyOpt] = await db
    .select({ title: selectOptions.title })
    .from(selectOptions)
    .where(eq(selectOptions.id, companyCountryOptionId))
    .limit(1);
  if (!companyOpt) return null;

  // Find the deals.country attribute
  const [dealsCountryAttr] = await db
    .select()
    .from(attributes)
    .where(and(eq(attributes.objectId, dealsObjectId), eq(attributes.slug, "country")))
    .limit(1);
  if (!dealsCountryAttr) return null;

  // Find the matching option by title
  const [dealsOpt] = await db
    .select({ id: selectOptions.id })
    .from(selectOptions)
    .where(
      and(
        eq(selectOptions.attributeId, dealsCountryAttr.id),
        eq(selectOptions.title, companyOpt.title)
      )
    )
    .limit(1);

  return dealsOpt?.id ?? null;
}

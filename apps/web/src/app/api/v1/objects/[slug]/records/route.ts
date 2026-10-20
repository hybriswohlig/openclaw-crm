import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, badRequest, success } from "@/lib/api-utils";
import { getObjectBySlug } from "@/services/objects";
import { listRecords, createRecord } from "@/services/records";
import { assignDealNumber } from "@/services/financial";
import { resolveDealSelectInputs } from "@/services/deal-attribution";
import { SOURCE_CHANNEL_SLUG, sourceFromMovingLeadPayload } from "@/lib/deal-source";
import { KONTAKTART_SLUG } from "@/lib/kontaktart";
import { applyKontaktart, kontaktartFromPeopleInput, resolvePeopleKontaktartInput } from "@/services/kontaktart";

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
  let { values } = body;

  if (!values || typeof values !== "object") {
    return badRequest("values object is required");
  }

  if (slug === "deals") {
    if (!values[SOURCE_CHANNEL_SLUG]) {
      const derived = sourceFromMovingLeadPayload(values.moving_lead_payload);
      if (derived) values = { ...values, [SOURCE_CHANNEL_SLUG]: derived };
    }
    values = await resolveDealSelectInputs(obj.id, values);
  }
  const kontaktartRaw = slug === "people" ? values[KONTAKTART_SLUG] : undefined;
  if (slug === "people" && typeof kontaktartRaw === "string") {
    values = await resolvePeopleKontaktartInput(obj.id, values);
  }

  const record = await createRecord(obj.id, values, ctx.userId);

  if (slug === "deals" && record) {
    await assignDealNumber(ctx.workspaceId, record.id);
  }
  if (slug === "people" && record && typeof kontaktartRaw === "string") {
    const slugValue = await kontaktartFromPeopleInput(obj.id, kontaktartRaw);
    if (slugValue) {
      await applyKontaktart({
        workspaceId: ctx.workspaceId,
        kontaktart: slugValue,
        personRecordId: record.id,
        actorId: ctx.userId,
        personAlreadyWritten: true,
      });
    }
  }

  return success(record, 201);
}

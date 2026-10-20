import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { prepareDealPhotoUploads } from "@/lib/deal-photo-upload";
import { uploadInternalDealPhotos } from "@/services/deal-photos";

/**
 * JSON photo upload for a deal.
 *
 * Bearer oc_sk_* is accepted by getAuthContext. Body is either one photo
 * `{ filename, contentType, dataBase64 }` or `{ photos: [...] }`.
 *
 * Stored on the deal (deal_internal_photos), including when the deal has
 * no chat. They show under Medien and on the deal photo step, stay
 * customerVisible false, and do not create a message or a bridge send.
 * A content hash that already exists on the deal is skipped.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const { recordId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid JSON body" } },
      { status: 400 }
    );
  }

  const prepared = prepareDealPhotoUploads(body);
  if (!prepared.ok) {
    return NextResponse.json(
      { error: { code: prepared.code, message: prepared.error } },
      { status: prepared.status }
    );
  }

  const result = await uploadInternalDealPhotos({
    workspaceId: ctx.workspaceId,
    dealRecordId: recordId,
    photos: prepared.photos,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.code, message: result.error } },
      { status: result.status }
    );
  }

  return success({ photos: result.photos, skipped: result.skipped });
}

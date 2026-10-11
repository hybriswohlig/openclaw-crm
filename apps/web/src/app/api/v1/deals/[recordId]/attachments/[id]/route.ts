import { NextResponse } from "next/server";

/**
 * Agents invent GET /api/v1/deals/{recordId}/attachments/{id} after seeing
 * the metadata list at ../attachments. There is no per-attachment resource
 * here — inbox bytes live at /api/v1/inbox/attachments/{id}.
 *
 * Answer JSON so crm_api does not fall through to the Next.js HTML app shell
 * (which it used to report as HTTP 404 / INVALID_JSON).
 */
export async function GET() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

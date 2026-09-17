import { NextResponse } from "next/server";

/**
 * Invented path: /api/v1/deals/{recordId}/attachments/{id}/content
 *
 * The real byte stream is /api/v1/inbox/attachments/{id}/content (and the
 * JSON twin is /api/v1/inbox/attachments/{id}). Returning JSON here stops
 * crm_api from treating the Next.js HTML 404 as INVALID_JSON.
 */
export async function GET() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

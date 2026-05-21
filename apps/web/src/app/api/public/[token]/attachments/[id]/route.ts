import { NextRequest } from "next/server";
import { getScopedAttachment } from "@/services/customer-portal-data";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await params;
  const att = await getScopedAttachment(token, id);
  if (!att) return new Response("Not found", { status: 404 });

  const bytes = Buffer.from(att.fileContent, "base64");
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": att.mimeType,
      "Content-Disposition": `inline; filename="${att.fileName.replace(/[\\"]/g, "_")}"`,
      "Cache-Control": "private, max-age=86400",
    },
  });
}

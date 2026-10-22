import { NextRequest } from "next/server";
import { getScopedAttachment } from "@/services/customer-portal-data";
import { fileResponseHeaders } from "@/lib/file-response";

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
      ...fileResponseHeaders({ mimeType: att.mimeType, fileName: att.fileName }),
      "Cache-Control": "private, max-age=86400",
    },
  });
}

import { NextRequest } from "next/server";
import { getScopedDocument } from "@/services/customer-portal-data";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await params;
  const doc = await getScopedDocument(token, id);
  if (!doc) return new Response("Not found", { status: 404 });

  const bytes = Buffer.from(doc.fileContent, "base64");
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `inline; filename="${encodeFilename(doc.fileName)}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}

function encodeFilename(name: string): string {
  return name.replace(/[\\"]/g, "_");
}

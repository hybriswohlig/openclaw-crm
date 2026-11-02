import { after, NextRequest } from "next/server";
import { getScopedDocument } from "@/services/customer-portal-data";
import { fileResponseHeaders } from "@/lib/file-response";
import { shouldRecordPortalHit } from "@/lib/portal-open-tracking";
import {
  crmUserIdFromRequest,
  recordPortalDocumentView,
  sessionIdFromRequest,
} from "@/services/portal-visit-tracking";

export const dynamic = "force-dynamic";

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "0.0.0.0";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await params;
  const doc = await getScopedDocument(token, id);
  if (!doc) return new Response("Not found", { status: 404 });

  const bytes = Buffer.from(doc.fileContent, "base64");
  const userAgent = req.headers.get("user-agent");
  if (shouldRecordPortalHit({ method: req.method, userAgent })) {
    const snapshot = {
      token,
      documentId: id,
      method: req.method,
      userAgent,
      ipAddress: clientIp(req),
      range: req.headers.get("range"),
      download: req.nextUrl.searchParams.get("dl") === "1",
      sessionId: sessionIdFromRequest(req),
      cookie: req.headers.get("cookie"),
      authorization: req.headers.get("authorization"),
    };
    try {
      after(async () => {
        await trackDocument(snapshot);
      });
    } catch (err) {
      console.error("[portal-tracking] after()", err);
    }
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      ...fileResponseHeaders({ mimeType: doc.mimeType, fileName: doc.fileName }),
      "Cache-Control": "private, max-age=300",
    },
  });
}

async function trackDocument(snapshot: {
  token: string;
  documentId: string;
  method: string;
  userAgent: string | null;
  ipAddress: string;
  range: string | null;
  download: boolean;
  sessionId: string | null;
  cookie: string | null;
  authorization: string | null;
}): Promise<void> {
  try {
    const headers = new Headers();
    if (snapshot.cookie) headers.set("cookie", snapshot.cookie);
    if (snapshot.authorization) headers.set("authorization", snapshot.authorization);
    const probe = new NextRequest("http://crm.local/api/public/doc", { headers });
    const crmUserId = await crmUserIdFromRequest(probe);
    await recordPortalDocumentView({
      token: snapshot.token,
      documentId: snapshot.documentId,
      method: snapshot.method,
      userAgent: snapshot.userAgent,
      ipAddress: snapshot.ipAddress,
      range: snapshot.range,
      download: snapshot.download,
      sessionId: snapshot.sessionId,
      crmUserId,
    });
  } catch (err) {
    console.error("[portal-tracking] document view", err);
  }
}

import { after, NextRequest, NextResponse } from "next/server";
import { parseUnterschriftPayload } from "@openclaw-crm/customer-portal-core";
import { unterschriftFuerToken, type UnterschriftGrund } from "@/services/kva-unterschrift";

export const dynamic = "force-dynamic";

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "0.0.0.0";
}

const STATUS: Record<UnterschriftGrund, number> = {
  invalid_token: 400,
  bild_ungueltig: 400,
  not_found: 404,
  deaktiviert: 404,
  revoked: 410,
  keine_annahme: 409,
  kein_pdf: 409,
  bereits_unterschrieben: 409,
  angebot_geaendert: 409,
  pdf_fehler: 500,
};

/** Freiwillige Unterschrift nach der Annahme: Vertragsmappe erzeugen und ablegen. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const raw = await req.json().catch(() => null);
  const body = parseUnterschriftPayload(raw);
  if (!body) {
    return NextResponse.json({ error: { code: "BAD_REQUEST" } }, { status: 400 });
  }

  const result = await unterschriftFuerToken(token, body, {
    ipAddress: clientIp(req),
    userAgent: req.headers.get("user-agent") ?? "",
  });
  if (!result.ok) {
    return NextResponse.json({ error: { code: result.reason.toUpperCase() } }, { status: STATUS[result.reason] });
  }

  // Versand an den Kunden und Hinweis ans Team laufen nach der Antwort.
  after(result.nachlauf);
  return NextResponse.json({ data: { ok: true } });
}

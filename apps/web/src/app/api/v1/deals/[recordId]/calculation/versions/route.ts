import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import {
  autorAus,
  dealImWorkspace,
  dealNichtGefunden,
  listenEintrag,
  versionsFehlerAntwort,
} from "@/lib/kalkulation-versionen-antwort";
import { entwurfHolenOderAnlegen } from "@/services/kalkulation-versionen";
import { dbVersionsSpeicher } from "@/services/kalkulation-versionen-speicher";

type Params = { params: Promise<{ recordId: string }> };

/**
 * GET → Versionen des Deals, ohne Schnappschüsse des Rechners:
 * `{ versionen: [{ version, status, priceCents, lockedAt, sentAt, sentVia, tariff, error }] }`.
 * Liest nur Gespeichertes (kein Rechner-Aufruf), auch mit Nur-Lese-Schlüssel.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return dealNichtGefunden();

  const liste = await dbVersionsSpeicher.liste(ctx.workspaceId, recordId);
  return success({ versionen: liste.map(listenEintrag) });
}

/**
 * POST (leerer Body) → Entwurf des Deals holen oder anlegen: `{ version, neu }`.
 * Der Autor kommt aus dem Auth-Kontext (API-Schlüssel = Agent), nie aus dem Body.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return dealNichtGefunden();

  try {
    const r = await entwurfHolenOderAnlegen(ctx.workspaceId, recordId, autorAus(ctx));
    return success({ version: r.version, neu: r.neu });
  } catch (err) {
    const antwort = versionsFehlerAntwort(err);
    if (antwort) return antwort;
    throw err;
  }
}

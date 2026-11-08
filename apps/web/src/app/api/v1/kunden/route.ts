import { NextRequest } from "next/server";
import { badRequest, forbidden, getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { KUNDEN_ANSICHTEN, type KundenAnsicht } from "@/lib/bewertungen-kunden";
import { ladeKundenListe } from "@/services/kunden";

export const dynamic = "force-dynamic";

function istAnsicht(v: string): v is KundenAnsicht {
  return (KUNDEN_ANSICHTEN as readonly string[]).includes(v);
}

/** GET ?ansicht=&q=&weiter= → Kundenliste. Nur Sitzung, API-Schlüssel 403. */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  if (ctx.authMethod !== "cookie") return forbidden("Kunden sind nur in der angemeldeten Sitzung lesbar.");

  const roh = req.nextUrl.searchParams.get("ansicht");
  const ansicht = roh == null || roh === "" ? "kunden" : roh;
  if (!istAnsicht(ansicht)) return badRequest("Unbekannte Ansicht.");

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const weiterRoh = req.nextUrl.searchParams.get("weiter");
  const weiter = weiterRoh ? weiterRoh : null;
  return success(await ladeKundenListe(ctx.workspaceId, { ansicht, q, weiter }));
}

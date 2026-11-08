/**
 * GET /api/v1/bewertungen?firma=&liste=
 * Arbeitsliste. Nur Sitzung, API-Schlüssel 403.
 */
import { NextRequest } from "next/server";
import { badRequest, forbidden, getAuthContext, success, unauthorized } from "@/lib/api-utils";
import type { BewertungListe } from "@/lib/bewertungen-kunden";
import { ladeBewertungen } from "@/services/bewertungen-liste";

export const dynamic = "force-dynamic";

const LISTEN: readonly BewertungListe[] = ["freigabe", "vorgemerkt", "faellig", "angefragt", "geklickt", "gesperrt"];

function istListe(v: string): v is BewertungListe {
  return (LISTEN as readonly string[]).includes(v);
}

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  if (ctx.authMethod !== "cookie") return forbidden("Nur in der angemeldeten Sitzung.");

  const listeRaw = req.nextUrl.searchParams.get("liste");
  const firma = req.nextUrl.searchParams.get("firma")?.trim() || undefined;
  if (listeRaw && !istListe(listeRaw)) return badRequest("Unbekannte Liste.");

  return success(
    await ladeBewertungen(ctx.workspaceId, {
      firmaId: firma,
      liste: listeRaw && istListe(listeRaw) ? listeRaw : undefined,
    })
  );
}

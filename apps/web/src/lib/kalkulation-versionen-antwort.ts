/**
 * Gemeinsames der Routen unter `/api/v1/deals/[recordId]/calculation/versions`:
 * Autor aus dem Auth-Kontext (nie aus dem Body), Fehler des Versionen-Dienstes
 * als Antwort, Versionsnummer aus dem Pfad, Listenform ohne Schnappschüsse und
 * die Prüfung, dass der Deal zum Workspace gehört (in SQL, vor allem anderen).
 */
import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { objects } from "@/db/schema/objects";
import { records } from "@/db/schema/records";
import { badRequest, type AuthContext } from "@/lib/api-utils";
import { UebersteuerungFehler } from "@/lib/kalkulation-versionen";
import { VersionsFehler, type Autor, type VersionsZeile } from "@/services/kalkulation-versionen";
import { annahmeSperrAntwort } from "@/services/kva-annahme";

/** API-Schlüssel = Agent, Sitzung = Mensch. */
export function autorAus(ctx: AuthContext): Autor {
  return { userId: ctx.userId, quelle: ctx.authMethod === "api_key" ? "agent" : "mensch" };
}

/**
 * `VersionsFehler` → `{ error: { code, message } }` mit seinem Status,
 * Kundenannahme → 409 `KVA_ACCEPTED`, ungültige Übersteuerung → 400.
 * Sonst null (weiterwerfen).
 */
export function versionsFehlerAntwort(err: unknown): NextResponse | null {
  const gesperrt = annahmeSperrAntwort(err);
  if (gesperrt) return gesperrt;
  if (err instanceof VersionsFehler) {
    return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
  }
  if (err instanceof UebersteuerungFehler) return badRequest(err.message);
  return null;
}

/** Höchster Wert einer Postgres-`integer`-Spalte. */
const INT_MAX = 2_147_483_647;

/** Versionsnummer aus dem Pfad: nur positive ganze Zahl ("1", "12"), sonst null. */
export function versionAusPfad(segment: string): number | null {
  if (!/^[1-9]\d*$/.test(segment)) return null;
  const n = Number(segment);
  return Number.isSafeInteger(n) && n <= INT_MAX ? n : null;
}

export function ungueltigeVersion(): NextResponse {
  return badRequest("Version muss eine positive ganze Zahl sein.");
}

export function dealNichtGefunden(): NextResponse {
  return NextResponse.json({ error: { code: "NOT_FOUND", message: "Deal nicht gefunden." } }, { status: 404 });
}

/** Eintrag der Versionsliste: ohne Anfrage, Ergebnis und Zeilen des Rechners. */
export function listenEintrag(v: VersionsZeile) {
  return {
    version: v.version,
    status: v.status,
    priceCents: v.priceCents,
    lockedAt: v.lockedAt,
    sentAt: v.sentAt,
    sentVia: v.sentVia,
    tariff: v.tariff,
    error: v.error,
  };
}

/** Deal-Datensatz (Objekt `deals`, nicht gelöscht) im Workspace? */
export async function dealImWorkspace(workspaceId: string, dealRecordId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: records.id })
    .from(records)
    .innerJoin(objects, eq(records.objectId, objects.id))
    .where(
      and(
        eq(records.id, dealRecordId),
        eq(objects.workspaceId, workspaceId),
        eq(objects.slug, "deals"),
        isNull(records.deletedAt)
      )
    )
    .limit(1);
  return !!row;
}

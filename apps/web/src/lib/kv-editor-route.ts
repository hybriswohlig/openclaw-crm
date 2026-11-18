/**
 * Gemeinsames der Routen unter `/api/v1/deals/[recordId]/kv-editor` (Plan KV-Editor, Aufgabe 5):
 * Auth, nur Menschen, Deal im Workspace, Aufrufer mit Admin-Rolle, zod-Eingaben und Fehler als
 * `{ error: { code, message, daten? } }` über `KvEditorFehlerKlasse`.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthContext, unauthorized, type AuthContext } from "@/lib/api-utils";
import { dealImWorkspace } from "@/lib/kalkulation-versionen-antwort";
import type { KonflikteEingabe, KvAufrufer, KvChatEingabe, PushenEingabe, StandAnlegenEingabe } from "@/lib/kv-editor";
import { istKvEditorFehler, KvEditorFehlerKlasse } from "@/services/kv-editor-fehler";

export type KvParams = { params: Promise<{ recordId: string }> };
export type KvStandParams = { params: Promise<{ recordId: string; standId: string }> };

/** Fehler des Dienstes als Antwort mit seinem Status, sonst null (weiterwerfen). */
export function kvFehlerAntwort(err: unknown): NextResponse | null {
  if (!istKvEditorFehler(err)) return null;
  return NextResponse.json(err.antwort(), { status: err.status });
}

function fehlerAntwort(f: KvEditorFehlerKlasse): NextResponse {
  return NextResponse.json(f.antwort(), { status: f.status });
}

/**
 * Rahmen jeder Route, in dieser Reihenfolge: angemeldet (401), kein API-Schlüssel (403
 * `NUR_MENSCH`), Deal im Workspace (404 `KEIN_KV`, ohne zu verraten, ob es ihn anderswo gibt),
 * dann `f` mit `wer.admin` aus der Workspace-Rolle (wie Plan 16). Fehler des Dienstes werden
 * zur Antwort mit ihrem Status, alles andere zu 500 `INTERN` (geloggt).
 */
export async function kvRoute(
  req: NextRequest,
  params: Promise<{ recordId: string }>,
  f: (ctx: AuthContext, deal: string, wer: KvAufrufer) => Promise<NextResponse>
): Promise<NextResponse> {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  if (ctx.authMethod === "api_key") return fehlerAntwort(new KvEditorFehlerKlasse("NUR_MENSCH"));
  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return fehlerAntwort(new KvEditorFehlerKlasse("KEIN_KV", "Deal nicht gefunden."));
  try {
    return await f(ctx, recordId, { userId: ctx.userId, admin: ctx.workspaceRole === "admin" });
  } catch (err) {
    const antwort = kvFehlerAntwort(err);
    if (antwort) return antwort;
    // Alles andere (Renderer, Datenbank) als JSON wie die übrigen Fehler, nicht als HTML-Seite (Review 9).
    console.error("[kv-editor] unerwarteter Fehler", err);
    return NextResponse.json(
      { error: { code: "INTERN", message: "Das hat nicht geklappt. Bitte noch einmal versuchen; bleibt es so, Dario Bescheid sagen." } },
      { status: 500 }
    );
  }
}

/** JSON-Körper mit zod prüfen; kaputtes JSON oder falsche Form → `UNGUELTIG` (400). Fremdfelder fallen weg. */
export async function kvKoerper<T>(req: NextRequest, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T> {
  const roh: unknown = await req.json().catch(() => undefined);
  const r = schema.safeParse(roh);
  if (!r.success) throw new KvEditorFehlerKlasse("UNGUELTIG", "Eingabe ungültig.");
  return r.data;
}

// ─── Eingaben ────────────────────────────────────────────────────────────────

const schluessel = z.string().min(1).max(200);
const id = z.string().min(1).max(200);

export const kvWertSchema = z.union([z.string().max(4000), z.boolean()]);

export const standAnlegenSchema = z.object({
  vorgaengerId: id,
  setzen: z.array(z.object({ schluessel, wert: kvWertSchema })).max(500),
  zuruecksetzen: z.array(schluessel).max(500),
  kiNachrichtId: id.optional(),
}) satisfies z.ZodType<StandAnlegenEingabe, z.ZodTypeDef, unknown>;

export const pushenSchema = z.object({
  erwartetAktuellDokumentId: id.nullable(),
  annahmeAufhebenBestaetigt: z.boolean().optional(),
}) satisfies z.ZodType<PushenEingabe, z.ZodTypeDef, unknown>;

export const konflikteSchema = z.object({
  standId: id,
  entscheidungen: z.array(z.object({ schluessel, aktion: z.enum(["uebernehmen", "verwerfen"]) })).min(1).max(200),
}) satisfies z.ZodType<KonflikteEingabe, z.ZodTypeDef, unknown>;

/** Text 1 bis 4000 Zeichen nach dem Trimmen (die Oberfläche begrenzt enger). */
export const chatSchema = z.object({
  standId: id,
  text: z.string().trim().min(1).max(4000),
}) satisfies z.ZodType<KvChatEingabe, z.ZodTypeDef, unknown>;

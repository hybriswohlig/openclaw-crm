/**
 * Server-Abläufe des Termin-Dialogs (Plan 5b, Entscheidung 12): welcher
 * Dialog gilt, Raster laden, „Tage anbieten“ speichern, danach wie auf der
 * Kalkulationsseite sperren und den KV erstellen. Ohne React, damit die
 * Tests `fetch` mocken können. Alle Aufrufe über `apiAufruf` (deutsche
 * Fehlermeldungen, nie eine Ausnahme).
 *
 * Routen: `GET …/calculation/versions`, `GET …/[v]/ansicht`,
 * `POST …/[v]/tage { von, bis }` → `TagesRaster` (nichts gespeichert),
 * `PUT …/[v]/tage` (`TageAnbieten`) → `VersionsZeile` (aus einer gesperrten
 * Version legt der Dienst den nächsten Entwurf an), `POST …/[v]/lock`,
 * `POST …/[v]/kv`.
 */
import { apiAufruf, jsonAufruf, type ApiAntwort } from "@/components/neu/akte/api";
import type { TageAnbieten, TagesRaster } from "@/lib/angebot-wahl";
import type { KalkulationsAnsicht } from "@/lib/kalkulations-ansicht";
import { sperrKoerper } from "@/components/neu/kalkulation/preis-logik";

export function versionenBasis(dealId: string): string {
  return `/api/v1/deals/${encodeURIComponent(dealId)}/calculation/versions`;
}

/** Link auf die Kalkulationsseite einer Version. */
export function kalkulationLink(dealId: string, version: number): string {
  return `/app/leads/${encodeURIComponent(dealId)}/kalkulation?v=${version}`;
}

interface VersionsEintrag {
  version: number;
  status: "entwurf" | "gesperrt";
}

/** Wie die Kalkulationsseite: der Entwurf, sonst die neueste gesperrte Version; null ohne Version. */
export function versionWaehlen(liste: readonly VersionsEintrag[]): number | null {
  const entwurf = liste.find((v) => v.status === "entwurf");
  if (entwurf) return entwurf.version;
  let neueste: number | null = null;
  for (const v of liste) if (neueste === null || v.version > neueste) neueste = v.version;
  return neueste;
}

/** Warum der alte Dialog bleibt (für Tests und Fehlersuche, nicht angezeigt). */
export type AltGrund = "keine_version" | "schalter_aus" | "stunden" | "fehler";

export type DialogWahl = { art: "neu"; ansicht: KalkulationsAnsicht } | { art: "alt"; grund: AltGrund };

/**
 * Neuer Dialog nur, wenn die Firma Tagespreise hat (`ansicht.schalter`) und
 * eine Version existiert; im Stundenmodus gibt es keine Tagespreise (F15).
 * Jeder Fehler beim Laden führt in den alten Dialog: er bleibt immer der Rückfall.
 * Legt nie eine Version an.
 */
export async function dialogWaehlen(dealId: string, version: number | null): Promise<DialogWahl> {
  let nummer = version;
  if (nummer === null) {
    const liste = await apiAufruf<{ versionen: VersionsEintrag[] }>(versionenBasis(dealId));
    if (!liste.ok) return { art: "alt", grund: "fehler" };
    nummer = versionWaehlen(liste.data?.versionen ?? []);
    if (nummer === null) return { art: "alt", grund: "keine_version" };
  }
  const a = await ansichtLaden(dealId, nummer);
  if (!a.ok) return { art: "alt", grund: "fehler" };
  if (!a.data.schalter?.tagespreise) return { art: "alt", grund: "schalter_aus" };
  if (a.data.version.preisModus === "stunden") return { art: "alt", grund: "stunden" };
  return { art: "neu", ansicht: a.data };
}

/** Ansichtsmodell einer Version. */
export async function ansichtLaden(dealId: string, version: number): Promise<ApiAntwort<KalkulationsAnsicht>> {
  const r = await apiAufruf<{ ansicht: KalkulationsAnsicht }>(`${versionenBasis(dealId)}/${version}/ansicht`);
  if (!r.ok) return r;
  if (!r.data?.ansicht) return { ok: false, status: 500, code: null, message: "Die Kalkulation kam leer zurück." };
  return { ok: true, data: r.data.ansicht };
}

function istRaster(x: unknown): x is TagesRaster {
  return !!x && typeof x === "object" && Array.isArray((x as TagesRaster).zellen);
}

/** Raster eines Zeitraums (`POST …/tage`, speichert nichts). Nimmt `{ data: raster }` und `{ data: { raster } }`. */
export async function rasterLaden(dealId: string, version: number, von: string, bis: string): Promise<ApiAntwort<TagesRaster>> {
  const r = await apiAufruf<unknown>(`${versionenBasis(dealId)}/${version}/tage`, jsonAufruf("POST", { von, bis }));
  if (!r.ok) return r;
  const d = r.data as { raster?: unknown } | undefined;
  const raster = istRaster(d) ? d : istRaster(d?.raster) ? d.raster : null;
  if (!raster) return { ok: false, status: 500, code: null, message: "Das Raster kam leer zurück." };
  return { ok: true, data: raster };
}

/**
 * „Tage anbieten“ (`PUT …/tage`). Gibt die Nummer der Version zurück, in der
 * die Tage jetzt stehen (der Entwurf, ggf. neu angelegt). Nimmt die
 * `VersionsZeile` direkt oder als `{ version: VersionsZeile }`.
 */
export async function tageSpeichern(dealId: string, version: number, koerper: TageAnbieten): Promise<ApiAntwort<{ version: number }>> {
  const r = await apiAufruf<unknown>(`${versionenBasis(dealId)}/${version}/tage`, jsonAufruf("PUT", koerper));
  if (!r.ok) return r;
  const d = r.data as { version?: unknown } | undefined;
  const nummer =
    typeof d?.version === "number"
      ? d.version
      : d?.version && typeof d.version === "object" && typeof (d.version as { version?: unknown }).version === "number"
        ? (d.version as { version: number }).version
        : null;
  if (nummer === null) return { ok: false, status: 500, code: null, message: "Die gespeicherte Version kam ohne Nummer zurück." };
  return { ok: true, data: { version: nummer } };
}

/** Texte für `POST …/kv` (`copy`), nur gefüllte Felder (wie der KV-Dialog der Kalkulationsseite). */
export interface KvTexte {
  intro?: string;
  remarks?: string;
}

export type SperrErgebnis =
  | { art: "fertig"; fileName: string | null }
  | { art: "kottke"; hinweis: string | null }
  | { art: "preis_geaendert"; message: string }
  | { art: "fehler"; schritt: "sperren" | "kv"; message: string };

/**
 * Wie `MargeSpalte.sperrenUndKv`: beim Entwurf `lock` mit dem Preis-Hash aller
 * Kundenpreise (`erwartetPreisHash`, Plan 5b), ohne Hash mit dem gesehenen Preis
 * (`erwartetPreisCent`), dann `kv`. Bei einer gesperrten Version
 * ohne KV nur `kv`. Kottke (`renderer: "vps"`): der nächste Dialog erzeugt das PDF.
 */
export async function sperrenUndKv(dealId: string, ansicht: KalkulationsAnsicht, texte: KvTexte): Promise<SperrErgebnis> {
  const basis = `${versionenBasis(dealId)}/${ansicht.version.nummer}`;
  if (ansicht.version.status === "entwurf") {
    // Dieselbe Regel wie die Kalkulationsseite: mit Preis-Hash nur der Hash (er deckt die
    // Standardwahl mit ab), ohne Hash wie vor 5b der gezeigte Preis.
    const koerper = sperrKoerper(ansicht);
    const sperre = await apiAufruf<{ version: { version: number } }>(`${basis}/lock`, jsonAufruf("POST", koerper));
    if (!sperre.ok) {
      if (sperre.status === 409 && sperre.code === "PREIS_GEAENDERT") return { art: "preis_geaendert", message: sperre.message };
      return { art: "fehler", schritt: "sperren", message: sperre.message };
    }
  }
  const kv = await apiAufruf<{ renderer: "crm" | "vps"; fileName?: string; hinweis?: string }>(
    `${basis}/kv`,
    jsonAufruf("POST", { copy: texte })
  );
  if (!kv.ok) return { art: "fehler", schritt: "kv", message: kv.message };
  if (kv.data?.renderer === "vps") return { art: "kottke", hinweis: kv.data.hinweis ?? null };
  return { art: "fertig", fileName: kv.data?.fileName ?? null };
}

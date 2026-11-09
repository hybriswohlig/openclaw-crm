/**
 * Plan 15, Bauteil 14: Korrekturen an Inventarzeilen. Rein, ohne Datenbank.
 * - `pruefeGroesseVolumen`: Größenklasse und m³ je Stück aus dem PATCH-Body
 * - `korrekturPayload`: was das Ereignis `inventar.korrigiert` trägt (Herkunft „von
 *   Hand, Name, Zeit“ und das Lernsignal „Foto erkannt: X, korrigiert: Y“)
 */
export const INVENTAR_KORRIGIERT_EVENT = "inventar.korrigiert";

const GROESSEN = new Set(["klein", "mittel", "gross", "sperrig"]);

export type InventarStand = {
  name: string;
  quantity: number;
  sizeClass: string | null;
  volumeCbmEstimate: string | number | null;
  source: string;
  photoAttachmentId: string | null;
};

export interface KorrekturPayload {
  itemId: string;
  art: "geaendert" | "entfernt" | "hinzugefuegt";
  /** true: die Zeile kam aus der Fotoerkennung (Lernsignal) */
  ausFoto: boolean;
  fotoId: string | null;
  vorher: { name: string; menge: number; groesse: string | null; volumenCbm: number | null } | null;
  nachher: { name: string; menge: number; groesse: string | null; volumenCbm: number | null } | null;
  /** „Foto erkannt: Gartensessel, korrigiert: Gartengrill“ */
  text: string;
}

function zahl(w: unknown): number | null {
  const n = typeof w === "number" ? w : typeof w === "string" && w.trim() !== "" ? Number(w.replace(",", ".")) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Größenklasse und Volumen je Stück aus dem Body; `volumeCbmEstimate` bleibt die ganze Zeile. */
export function pruefeGroesseVolumen(
  body: Record<string, unknown>,
  menge: number
): { ok: true; patch: { sizeClass?: string | null; volumeCbmEstimate?: string | null } } | { ok: false; fehler: string } {
  const patch: { sizeClass?: string | null; volumeCbmEstimate?: string | null } = {};
  if ("sizeClass" in body) {
    const g = body.sizeClass;
    if (g === null || g === "") patch.sizeClass = null;
    else if (typeof g === "string" && GROESSEN.has(g)) patch.sizeClass = g;
    else return { ok: false, fehler: "sizeClass muss klein, mittel, gross oder sperrig sein" };
  }
  if ("volumeCbmPerPiece" in body) {
    const v = body.volumeCbmPerPiece;
    if (v === null || v === "") patch.volumeCbmEstimate = null;
    else {
      const n = zahl(v);
      if (n === null || n <= 0 || n > 30) return { ok: false, fehler: "volumeCbmPerPiece: größer als 0, höchstens 30 m³" };
      patch.volumeCbmEstimate = String(Math.round(n * menge * 1000) / 1000);
    }
  }
  return { ok: true, patch };
}

function stand(z: InventarStand | null) {
  if (!z) return null;
  const menge = z.quantity > 0 ? z.quantity : 1;
  const gesamt = zahl(z.volumeCbmEstimate);
  return { name: z.name, menge, groesse: z.sizeClass, volumenCbm: gesamt !== null ? Math.round((gesamt / menge) * 1000) / 1000 : null };
}

export function korrekturPayload(itemId: string, vorher: InventarStand | null, nachher: InventarStand | null): KorrekturPayload {
  const v = stand(vorher);
  const n = stand(nachher);
  const ausFoto = (vorher ?? nachher)?.source === "foto";
  const art: KorrekturPayload["art"] = !vorher ? "hinzugefuegt" : !nachher ? "entfernt" : "geaendert";
  const teile: string[] = [];
  if (v && n && v.name !== n.name) teile.push(`korrigiert: ${n.name}`);
  if (v && n && v.menge !== n.menge) teile.push(`Menge ${v.menge} → ${n.menge}`);
  if (v && n && v.groesse !== n.groesse) teile.push(`Größe ${v.groesse ?? "offen"} → ${n.groesse ?? "offen"}`);
  if (v && n && v.volumenCbm !== n.volumenCbm) teile.push(`${v.volumenCbm ?? "?"} → ${n.volumenCbm ?? "?"} m³ je Stück`);
  const kopf = ausFoto ? `Foto erkannt: ${v?.name ?? n?.name}` : v?.name ?? n?.name ?? "";
  const text =
    art === "entfernt" ? `${kopf}, entfernt (falsch erkannt)` : art === "hinzugefuegt" ? `Hinzugefügt: ${n?.name}` : [kopf, ...teile].join(", ");
  return { itemId, art, ausFoto, fotoId: (vorher ?? nachher)?.photoAttachmentId ?? null, vorher: v, nachher: n, text };
}

/**
 * Review M12: ändert sich nur die Menge, bleibt das Volumen je Stück gleich (die Zeile
 * trägt das Gesamtvolumen). null, wenn nichts zu skalieren ist.
 */
export function volumenBeiMenge(alt: { quantity: number; volumeCbmEstimate: string | number | null }, neueMenge: number): string | null {
  const gesamt = zahl(alt.volumeCbmEstimate);
  if (gesamt === null || gesamt <= 0 || alt.quantity <= 0 || neueMenge === alt.quantity) return null;
  return String(Math.round((gesamt / alt.quantity) * neueMenge * 1000) / 1000);
}

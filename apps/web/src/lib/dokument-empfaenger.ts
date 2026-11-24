/**
 * Optionale Angaben am Deal, nur für Dokumente und die Statusseite.
 * Der WhatsApp-Kontakt bleibt die verknüpfte Person.
 *
 * Liegt als JSON-Attribut `dokument_empfaenger` am Deal. Keine neue Spalte.
 */

export const DOKUMENT_EMPFAENGER_SLUG = "dokument_empfaenger";

export const VERTRETEN_ROLLEN = [
  "gesetzliche_betreuerin",
  "gesetzlicher_betreuer",
  "bevollmaechtigte",
  "bevollmaechtigter",
  "angehoerige",
  "angehoeriger",
] as const;

export type VertretenRolle = (typeof VERTRETEN_ROLLEN)[number];

export const ROLLE_LABEL: Record<VertretenRolle, string> = {
  gesetzliche_betreuerin: "gesetzliche Betreuerin",
  gesetzlicher_betreuer: "gesetzlicher Betreuer",
  bevollmaechtigte: "Bevollmächtigte",
  bevollmaechtigter: "Bevollmächtigter",
  angehoerige: "Angehörige",
  angehoeriger: "Angehöriger",
};

export type DokumentAnrede = "sie" | "du";
export type AuftraggeberAnrede = "frau" | "herr" | "neutral";

export interface AuftraggeberAufDokument {
  anrede: AuftraggeberAnrede | null;
  name: string | null;
  adresse: string | null;
}

export interface VertretenDurch {
  name: string | null;
  rolle: VertretenRolle | null;
}

export interface DokumentEmpfaenger {
  anrede: DokumentAnrede | null;
  auftraggeber: AuftraggeberAufDokument | null;
  vertretenDurch: VertretenDurch | null;
}

export const LEERER_EMPFAENGER: DokumentEmpfaenger = {
  anrede: null,
  auftraggeber: null,
  vertretenDurch: null,
};

function objekt(wert: unknown): Record<string, unknown> | null {
  return wert && typeof wert === "object" && !Array.isArray(wert) ? (wert as Record<string, unknown>) : null;
}

function text(wert: unknown, max = 200): string | null {
  if (typeof wert !== "string") return null;
  const t = wert.trim().slice(0, max);
  return t || null;
}

function eineVon<T extends string>(wert: unknown, erlaubt: readonly T[]): T | null {
  return typeof wert === "string" && (erlaubt as readonly string[]).includes(wert) ? (wert as T) : null;
}

/** Lesen: unbekannte oder halbe Werte werden verworfen, nie geworfen. */
export function parseDokumentEmpfaenger(roh: unknown): DokumentEmpfaenger {
  const o = objekt(roh);
  if (!o) return { ...LEERER_EMPFAENGER };
  const ag = objekt(o.auftraggeber);
  const vd = objekt(o.vertretenDurch);
  const name = text(ag?.name);
  const vertretenName = text(vd?.name);
  return {
    anrede: eineVon(o.anrede, ["sie", "du"] as const),
    auftraggeber: name
      ? { anrede: eineVon(ag?.anrede, ["frau", "herr", "neutral"] as const), name, adresse: text(ag?.adresse, 300) }
      : null,
    vertretenDurch: vertretenName
      ? { name: vertretenName, rolle: eineVon(vd?.rolle, VERTRETEN_ROLLEN) }
      : null,
  };
}

export function vertretenDurchZeile(v: VertretenDurch | null | undefined): string | null {
  const name = v?.name?.trim();
  if (!name) return null;
  const rolle = v?.rolle ? ROLLE_LABEL[v.rolle] : null;
  return rolle ? `vertreten durch ${name} (${rolle})` : `vertreten durch ${name}`;
}

export type DokumentPruefung =
  | { ok: true; wert: DokumentEmpfaenger }
  | { ok: false; fehler: string };

/**
 * Schreiben (UI, MCP, PATCH). Unbekannte Anrede oder Rolle ist ein Fehler,
 * leere Namen löschen das Feld.
 */
export function pruefeDokumentEmpfaenger(roh: unknown): DokumentPruefung {
  if (roh == null) return { ok: true, wert: { ...LEERER_EMPFAENGER } };
  const o = objekt(roh);
  if (!o) return { ok: false, fehler: "dokument_empfaenger muss ein Objekt sein." };
  if (o.anrede != null && o.anrede !== "" && eineVon(o.anrede, ["sie", "du"] as const) === null) {
    return { ok: false, fehler: "anrede ist sie oder du." };
  }
  const ag = o.auftraggeber == null ? null : objekt(o.auftraggeber);
  if (o.auftraggeber != null && !ag) return { ok: false, fehler: "auftraggeber muss ein Objekt sein." };
  if (ag?.anrede != null && ag.anrede !== "" && eineVon(ag.anrede, ["frau", "herr", "neutral"] as const) === null) {
    return { ok: false, fehler: "auftraggeber.anrede ist frau, herr oder neutral." };
  }
  const vd = o.vertretenDurch == null ? null : objekt(o.vertretenDurch);
  if (o.vertretenDurch != null && !vd) return { ok: false, fehler: "vertretenDurch muss ein Objekt sein." };
  if (vd?.rolle != null && vd.rolle !== "" && eineVon(vd.rolle, VERTRETEN_ROLLEN) === null) {
    return { ok: false, fehler: `vertretenDurch.rolle ist eine von: ${VERTRETEN_ROLLEN.join(", ")}.` };
  }
  return { ok: true, wert: parseDokumentEmpfaenger(o) };
}

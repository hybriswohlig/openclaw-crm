/**
 * Körper von POST und PATCH einer Transporter-Buchung. Typen hier, die
 * fachliche Prüfung (`pruefeBuchung`) macht die Route bzw. der Dienst.
 */
import type { BuchungEingabe, BuchungStatus } from "@/lib/einsatz";

const STATUS = new Set<BuchungStatus>(["geplant", "bestaetigt", "storniert"]);

function istObjekt(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function text(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function zahl(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function zahlOderNull(v: unknown): number | null | undefined {
  if (v === null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

function textOderNull(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v === "string") return v;
  return undefined;
}

/** Vollständige `BuchungEingabe`, sonst null. `status` darf fehlen. */
export function buchungNeu(body: unknown): BuchungEingabe | null {
  if (!istObjekt(body)) return null;
  const firmaId = text(body.firmaId);
  const von = text(body.von);
  const bis = text(body.bis);
  const stationId = text(body.stationId);
  const stationName = text(body.stationName);
  const klasseId = text(body.klasseId);
  const klasseName = text(body.klasseName);
  const mieteCent = zahl(body.mieteCent);
  const geplanteAuftraege = zahl(body.geplanteAuftraege);
  if (!firmaId || !von || !bis || !stationId || stationName === null || !klasseId || klasseName === null) return null;
  if (mieteCent === undefined || geplanteAuftraege === undefined) return null;
  if (!("stationAnbieter" in body) || !("inklusivKm" in body) || !("mehrkmSatzCent" in body) || !("notiz" in body)) return null;
  const stationAnbieter = textOderNull(body.stationAnbieter);
  const inklusivKm = zahlOderNull(body.inklusivKm);
  const mehrkmSatzCent = zahlOderNull(body.mehrkmSatzCent);
  const notiz = textOderNull(body.notiz);
  if (stationAnbieter === undefined || inklusivKm === undefined || mehrkmSatzCent === undefined || notiz === undefined) return null;
  let status: BuchungStatus | undefined;
  if ("status" in body && body.status !== undefined) {
    if (typeof body.status !== "string" || !STATUS.has(body.status as BuchungStatus)) return null;
    status = body.status as BuchungStatus;
  }
  return {
    firmaId,
    von,
    bis,
    stationId,
    stationName,
    stationAnbieter,
    klasseId,
    klasseName,
    mieteCent,
    inklusivKm,
    mehrkmSatzCent,
    geplanteAuftraege,
    notiz,
    ...(status ? { status } : {}),
  };
}

/** Teiländerung. Leeres Objekt ist gültig. Falscher Typ eines genannten Feldes → null. */
export function buchungPatch(body: unknown): Partial<BuchungEingabe> | null {
  if (!istObjekt(body)) return null;
  const aus: Partial<BuchungEingabe> = {};
  if ("firmaId" in body) {
    const v = text(body.firmaId);
    if (!v) return null;
    aus.firmaId = v;
  }
  for (const feld of ["von", "bis", "stationId", "stationName", "klasseId", "klasseName"] as const) {
    if (!(feld in body)) continue;
    const v = text(body[feld]);
    if (v === null) return null;
    aus[feld] = v;
  }
  if ("stationAnbieter" in body) {
    const v = textOderNull(body.stationAnbieter);
    if (v === undefined) return null;
    aus.stationAnbieter = v;
  }
  if ("notiz" in body) {
    const v = textOderNull(body.notiz);
    if (v === undefined) return null;
    aus.notiz = v;
  }
  if ("mieteCent" in body) {
    const v = zahl(body.mieteCent);
    if (v === undefined) return null;
    aus.mieteCent = v;
  }
  if ("geplanteAuftraege" in body) {
    const v = zahl(body.geplanteAuftraege);
    if (v === undefined) return null;
    aus.geplanteAuftraege = v;
  }
  for (const feld of ["inklusivKm", "mehrkmSatzCent"] as const) {
    if (!(feld in body)) continue;
    const v = zahlOderNull(body[feld]);
    if (v === undefined) return null;
    aus[feld] = v;
  }
  if ("status" in body && body.status !== undefined) {
    if (typeof body.status !== "string" || !STATUS.has(body.status as BuchungStatus)) return null;
    aus.status = body.status as BuchungStatus;
  }
  return aus;
}

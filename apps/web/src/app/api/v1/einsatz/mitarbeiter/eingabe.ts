import { NextResponse, type NextRequest } from "next/server";
import { badRequest } from "@/lib/api-utils";
import type { StammdatenEingabe } from "@/lib/einsatz";

/** JSON-Körper oder 400. Leerer oder kaputter Körper ist kein stilles `{}`. */
export async function liesJson(req: NextRequest): Promise<{ body: unknown } | { antwort: NextResponse }> {
  try {
    return { body: await req.json() };
  } catch {
    return { antwort: badRequest("Ungültiges JSON") };
  }
}

/**
 * Nur die bekannten Stammdaten-Felder, mit dem Typ aus dem Vertrag.
 * Unbekannte Schlüssel fallen weg. Falscher Typ → null (Route: 400).
 */
export function stammdatenAus(body: unknown): StammdatenEingabe | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const o = body as Record<string, unknown>;
  const e: StammdatenEingabe = {};
  if ("name" in o) {
    if (typeof o.name !== "string") return null;
    e.name = o.name;
  }
  if ("plz" in o) {
    if (o.plz !== null && typeof o.plz !== "string") return null;
    e.plz = o.plz;
  }
  if ("wohnort" in o) {
    if (o.wohnort !== null && typeof o.wohnort !== "string") return null;
    e.wohnort = o.wohnort;
  }
  if ("kannSprinter" in o) {
    if (typeof o.kannSprinter !== "boolean") return null;
    e.kannSprinter = o.kannSprinter;
  }
  if ("eigenerPkw" in o) {
    if (typeof o.eigenerPkw !== "boolean") return null;
    e.eigenerPkw = o.eigenerPkw;
  }
  if ("satzFahrtCent" in o) {
    if (typeof o.satzFahrtCent !== "number") return null;
    e.satzFahrtCent = o.satzFahrtCent;
  }
  if ("satzArbeitCent" in o) {
    if (typeof o.satzArbeitCent !== "number") return null;
    e.satzArbeitCent = o.satzArbeitCent;
  }
  if ("aktiv" in o) {
    if (typeof o.aktiv !== "boolean") return null;
    e.aktiv = o.aktiv;
  }
  return e;
}

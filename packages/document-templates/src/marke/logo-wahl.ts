import type { ServiceType } from "../types";
import { LOGO_PNG } from "./logos";

/** Logo (base64-PNG) für Firma und Leistung; ohne Logo je Leistung das Grundlogo der Firma, sonst null. */
export function logoPngFuer(firma: string, leistung: ServiceType | null): string | null {
  return (leistung && LOGO_PNG[`${firma}:${leistung}`]) || LOGO_PNG[firma] || null;
}

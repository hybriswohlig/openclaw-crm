/**
 * Ist eine Adresse genau genug für Street View und Route? Genau heißt:
 * ein Straßenteil mit Hausnummer und dahinter eine PLZ oder ein Ort
 * ("Heilbronner Str. 339, 70469 Stuttgart", "Hauptstr. 5 Esslingen").
 * "Umzug innerhalb Stuttgart", "70469 Stuttgart" oder "Hauptstraße 12"
 * allein sind ungenau: dann kein Google-Abruf.
 *
 * Der Schlüssel ist der sha256-Hex der kleingeschriebenen Adresse mit
 * zusammengezogenen Leerzeichen (je Workspace eindeutig in
 * `street_view_images`).
 */
import { createHash } from "node:crypto";
import { istAdresseGenau } from "./adresse-regel";

export interface AdresseGenau {
  genau: boolean;
  /** Getrimmt, Leerzeichen zusammengezogen; null ohne Adresse. */
  text: string | null;
  /** sha256-Hex; null, wenn die Adresse ungenau ist oder fehlt. */
  schluessel: string | null;
}

export function adresseSchluessel(text: string): string {
  return createHash("sha256").update(text.toLowerCase().replace(/\s+/g, " ").trim()).digest("hex");
}

export function adresseGenau(a: unknown): AdresseGenau {
  if (typeof a !== "string") return { genau: false, text: null, schluessel: null };
  const text = a.replace(/\s+/g, " ").trim();
  if (text === "") return { genau: false, text: null, schluessel: null };
  if (!istAdresseGenau(text)) return { genau: false, text, schluessel: null };
  return { genau: true, text, schluessel: adresseSchluessel(text) };
}

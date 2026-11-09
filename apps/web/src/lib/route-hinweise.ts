/**
 * Status und Hinweistexte der Routenkarte (Plan 4, Task 6). Ohne Server-
 * Importe: die Oberfläche importiert diese Datei.
 */
export type RoutenStatus = "ok" | "ungenau" | "fehler" | "ohne_schluessel" | "nicht_freigegeben" | "nicht_geladen";

/** Hinweis je Status für die Oberfläche (null = Karte zeigen). */
export const ROUTE_HINWEISE: Record<RoutenStatus, string | null> = {
  ok: null,
  ungenau: "Ohne Beladeadresse keine Route.",
  fehler: "Route konnte nicht geladen werden.",
  ohne_schluessel: "Route ist nicht eingerichtet.",
  nicht_freigegeben: "Routes API ist für den Schlüssel nicht freigegeben.",
  nicht_geladen: "Route noch nicht geladen.",
};

/** Plan 15 (Bauteil 10): Route mit „PLZ Ort“ statt Straße. */
export const ROUTE_UNGEFAEHR = "ungefähr (nur PLZ), von Ortsmitte zu Ortsmitte";

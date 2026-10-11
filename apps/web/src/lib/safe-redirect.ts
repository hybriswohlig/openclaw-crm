/**
 * Weiterleitungsziel nach dem Login (`?redirect=`) absichern.
 *
 * Der Parameter steht in der URL und lässt sich von außen setzen. Erlaubt ist
 * deshalb nur ein relativer Pfad auf derselben Origin: Er beginnt mit genau
 * einem „/“ (nicht „//“ oder „/\“, die der Browser als fremden Host liest) und
 * hat kein Schema wie „https:“ oder „javascript:“. Alles andere ergibt den
 * Fallback. Zurück kommt der normalisierte Pfad samt Query und Hash.
 */

// Nur zum Auflösen relativer Pfade. Die Domain ist reserviert und wird nie
// aufgerufen.
const BASIS = "http://weiterleitung.invalid";

// Tab und Zeilenumbruch entfernt der URL-Parser stillschweigend, aus
// „/\t/evil.com“ würde so „//evil.com“.
const STEUERZEICHEN = /[\u0000-\u001F\u007F]/;

function istEinfacherPfad(pfad: string): boolean {
  return pfad.startsWith("/") && !pfad.startsWith("//") && !pfad.startsWith("/\\");
}

export function safeRedirectPath(
  ziel: string | null | undefined,
  fallback: string,
): string {
  if (typeof ziel !== "string" || ziel === "") return fallback;
  if (STEUERZEICHEN.test(ziel) || !istEinfacherPfad(ziel)) return fallback;

  let url: URL;
  try {
    url = new URL(ziel, BASIS);
  } catch {
    return fallback;
  }
  if (url.origin !== BASIS) return fallback;

  const pfad = url.pathname + url.search + url.hash;
  // Punkt-Segmente wie „/.//evil.com“ werden erst beim Normalisieren zu
  // „//evil.com“, darum das Ergebnis noch einmal prüfen.
  return istEinfacherPfad(pfad) ? pfad : fallback;
}

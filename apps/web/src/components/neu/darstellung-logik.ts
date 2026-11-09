/**
 * Plan 14b, Task S: reine Bausteine der Darstellung (hell, dunkel, wie das Gerät).
 * Die Komponenten in `darstellung.tsx` halten nur Zustand und DOM; alles, was sich
 * ohne Browser prüfen lässt, steht hier (das Repo hat kein jsdom).
 */
import {
  DARSTELLUNG_COOKIE,
  NEU_THEMEFARBE,
  cookieWert,
  darstellungLesen,
  istNeuPfad,
  themeAus,
  type DarstellungSpiegel,
  type LgTheme,
} from "@/lib/dunkel-abschaltung";

export { NEU_THEMEFARBE };

/** Darstellung aus `document.cookie`; ohne gültigen Wert `null` (dann gilt „system“). */
export function darstellungAusCookie(cookies: string): DarstellungSpiegel | null {
  return darstellungLesen(cookieWert(cookies, DARSTELLUNG_COOKIE));
}

/** Theme der neuen Oberfläche aus Darstellung und Gerät. */
export function themeFuer(d: DarstellungSpiegel | null, systemDunkel: boolean): LgTheme {
  return themeAus(d, systemDunkel);
}

/**
 * Abgleich nach dem Laden (Entscheidung 3): die Datenbank ist die Wahrheit. Liefert den
 * Wert, auf den Cookie und Zustand umgestellt werden müssen, oder `null`, wenn alles passt.
 * Ein fehlender Cookie zählt als Abweichung, damit das nächste Laden ohne Umspringen startet.
 */
export function abgleichNoetig(
  cookie: DarstellungSpiegel | null,
  gespeichert: DarstellungSpiegel,
  /** Hat jemand seit dem Start des Abrufs selbst gewählt? Dann ist die Antwort veraltet (Review M2). */
  gewaehltSeitAbruf = false
): DarstellungSpiegel | null {
  if (gewaehltSeitAbruf) return null;
  return cookie === gespeichert ? null : gespeichert;
}

/**
 * Theme der Toasts (Entscheidung 10): unter /app folgt es `data-lg-theme`, sonst wie bisher
 * next-themes. So bleibt ein Toast in der neuen Oberfläche hell, auch wenn next-themes
 * „dark“ gespeichert hat, und wird dunkel, wenn die neue Oberfläche dunkel ist.
 */
export function toasterTheme(
  pfad: string | null,
  lgTheme: string | null,
  resolvedTheme: string | undefined
): LgTheme {
  if (pfad && istNeuPfad(pfad)) return lgTheme === "dark" ? "dark" : "light";
  return resolvedTheme === "dark" ? "dark" : "light";
}

/** Stand eines `<meta name="theme-color">`, um ihn beim Verlassen von /app wiederherzustellen. */
export interface MetaStand {
  content: string | null;
  media: string | null;
}

export function themeFarbe(theme: LgTheme): string {
  return NEU_THEMEFARBE[theme];
}

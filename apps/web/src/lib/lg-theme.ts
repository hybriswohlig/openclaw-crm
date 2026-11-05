export function lgThemeFor(resolved: string | undefined): "light" | "dark" {
  return resolved === "dark" ? "dark" : "light";
}

/**
 * Hält data-lg-theme auf `theme`, auch wenn später jemand anderes es umschreibt.
 * GlassProvider wendet nach der Hydration gespeicherte Vorlieben
 * (glassy-ui-preferences) an und kann so ein „dark“ setzen, nachdem der Effekt
 * von LgThemeSync schon gelaufen ist. Der Beobachter setzt den Wert dann zurück.
 * Ein fehlendes Attribut bleibt fehlend: Das entfernt nur das Layout beim
 * Verlassen von /app, und dagegen darf hier nichts arbeiten.
 * Liefert die Aufräumfunktion (trennt den Beobachter).
 */
export function haltLgThemeFest(
  wurzel: HTMLElement,
  theme: "light" | "dark",
  Beobachter: typeof MutationObserver = MutationObserver
): () => void {
  wurzel.dataset.lgTheme = theme;
  const beobachter = new Beobachter(() => {
    const aktuell = wurzel.dataset.lgTheme;
    if (aktuell !== undefined && aktuell !== theme) wurzel.dataset.lgTheme = theme;
  });
  beobachter.observe(wurzel, { attributes: true, attributeFilter: ["data-lg-theme"] });
  return () => beobachter.disconnect();
}

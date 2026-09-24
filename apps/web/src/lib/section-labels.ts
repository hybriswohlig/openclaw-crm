/**
 * Lesbare Namen für Website-Abschnitte. tracking.js meldet die HTML-ID oder
 * eine aus der Überschrift gebildete Kennung (z. B. "eindruecke", "so-läuft-es").
 */
const KNOWN: Record<string, string> = {
  home: "Start",
  top: "Start",
  hero: "Start",
  services: "Leistungen",
  leistungen: "Leistungen",
  eindruecke: "Eindrücke",
  ueber: "Über uns",
  rechner: "Paket-Finder",
  pakete: "Pakete",
  preise: "Preise",
  bewertungen: "Bewertungen",
  faq: "Fragen",
  gebiet: "Gebiet",
  ablauf: "Ablauf",
  kontakt: "Kontakt",
  umzugstipps: "Umzugstipps",
  "vorher-nachher": "Vorher/Nachher",
  aufloesung: "Auflösung",
  wert: "Wertanrechnung",
};

export function sectionLabel(id: string | null | undefined): string {
  if (!id) return "Abschnitt";
  const known = KNOWN[id.toLowerCase()];
  if (known) return known;
  const text = id.replace(/[-_]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

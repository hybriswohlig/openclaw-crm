/**
 * Zuordnung der CRM-Zugangsoptionen zum Rechner. "Aufzug" ohne Größe gilt als
 * kleiner Aufzug: große Möbel gehen dann über die Treppe (vorsichtige Annahme).
 * Rein, ohne Imports: genutzt von rechnerAnfrageAus und der Grundlage der Kalkulation.
 */
export function zugangAusTitel(titel: string | null): { aufzug?: "keiner" | "klein" | "gross"; etage?: number } {
  switch ((titel ?? "").trim().toLowerCase()) {
    case "aufzug":
      return { aufzug: "klein" };
    case "treppe":
      return { aufzug: "keiner" };
    case "erdgeschoss":
    case "nicht nötig (einfamilienhaus)":
      return { aufzug: "keiner", etage: 0 };
    default:
      return {};
  }
}

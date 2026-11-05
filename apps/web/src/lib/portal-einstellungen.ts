import { brandingForOperatingCompany } from "@openclaw-crm/customer-portal-core";

/** Platzhalter für die Portal-Einstellungen: zeigt, was bei leerem Feld gilt. */
export function standardPlatzhalter(firma: string | null): { farbe: string; logo: string } {
  const b = brandingForOperatingCompany(firma);
  return {
    farbe: `${b.primaryColor} (Standard)`,
    logo: b.logoJeLeistung ? "leer: Logo je Leistung (Umzug, Entrümpelung, Küche)" : (b.logoUrl ?? "https://…/logo.png"),
  };
}

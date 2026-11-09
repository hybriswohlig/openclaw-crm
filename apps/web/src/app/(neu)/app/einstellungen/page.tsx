import type { Metadata } from "next";
import { EinstellungenSeite } from "@/components/neu/einstellungen/einstellungen-seite";
import { seitentitel } from "@/components/neu/nav-config";
import { rechnerBasisUrl } from "@/services/rechner/client";

export const metadata: Metadata = { title: seitentitel("/app/einstellungen") };
export const dynamic = "force-dynamic";

/** Einstellungen (Plan 13): Für mich, Firmen, Rechner (nur lesen), Zugänge. */
export default function EinstellungenPage() {
  // Nur der Origin des Rechners für den Link „Rechner öffnen“, nie ein Schlüssel.
  return <EinstellungenSeite rechnerUrl={rechnerBasisUrl()} />;
}

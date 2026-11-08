import type { Metadata } from "next";
import { BewertungenSeite } from "@/components/neu/bewertungen/bewertungen-seite";
import { seitentitel } from "@/components/neu/nav-config";

export const metadata: Metadata = { title: seitentitel("/app/bewertungen") };

/** Bewertungen (Plan 11): Arbeitsliste und Automatik je Firma. */
export default function BewertungenPage() {
  return <BewertungenSeite />;
}

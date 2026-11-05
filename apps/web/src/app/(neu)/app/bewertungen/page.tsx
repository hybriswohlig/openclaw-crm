import type { Metadata } from "next";
import { seitentitel } from "@/components/neu/nav-config";
import { Platzhalter } from "@/components/neu/platzhalter";

export const metadata: Metadata = { title: seitentitel("/app/bewertungen") };

// Keine eigene alte Seite für Bewertungen; bis dahin die alte Startseite.

export default function BewertungenPage() {
  return <Platzhalter pfad="/app/bewertungen" meilenstein={3} alteSeite="/home" />;
}

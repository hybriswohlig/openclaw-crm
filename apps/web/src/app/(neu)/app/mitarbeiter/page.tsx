import type { Metadata } from "next";
import { MitarbeiterSeite } from "@/components/neu/mitarbeiter/mitarbeiter-seite";
import { TransporterReiter } from "@/components/neu/mitarbeiter/transporter-reiter";
import { seitentitel } from "@/components/neu/nav-config";

export const metadata: Metadata = { title: seitentitel("/app/mitarbeiter") };

/** Mitarbeiter-Stammdaten und Abwesenheiten (Plan 12a), Reiter „Transporter“ (Plan 12b). */
export default function MitarbeiterPage() {
  return <MitarbeiterSeite transporter={<TransporterReiter />} />;
}

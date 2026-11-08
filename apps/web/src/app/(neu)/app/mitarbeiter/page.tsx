import type { Metadata } from "next";
import { MitarbeiterSeite } from "@/components/neu/mitarbeiter/mitarbeiter-seite";
import { seitentitel } from "@/components/neu/nav-config";

export const metadata: Metadata = { title: seitentitel("/app/mitarbeiter") };

/** Mitarbeiter-Stammdaten und Abwesenheiten (Plan 12a). */
export default function MitarbeiterPage() {
  return <MitarbeiterSeite />;
}

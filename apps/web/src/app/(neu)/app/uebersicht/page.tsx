import type { Metadata } from "next";
import { seitentitel } from "@/components/neu/nav-config";
import { UebersichtSeite } from "@/components/neu/uebersicht/uebersicht-seite";

export const metadata: Metadata = { title: seitentitel("/app/uebersicht") };

/** Übersicht (Plan 13): Umsatz, Anfragen, Abschlussquote, offene Beträge. */
export default function UebersichtPage() {
  return <UebersichtSeite />;
}

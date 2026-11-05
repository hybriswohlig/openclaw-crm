import type { Metadata } from "next";
import { seitentitel } from "@/components/neu/nav-config";
import { Platzhalter } from "@/components/neu/platzhalter";

export const metadata: Metadata = { title: seitentitel("/app/mitarbeiter") };

export default function MitarbeiterPage() {
  return <Platzhalter pfad="/app/mitarbeiter" meilenstein={3} alteSeite="/employees" />;
}

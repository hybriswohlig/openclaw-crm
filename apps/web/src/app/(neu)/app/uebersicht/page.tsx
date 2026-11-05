import type { Metadata } from "next";
import { seitentitel } from "@/components/neu/nav-config";
import { Platzhalter } from "@/components/neu/platzhalter";

export const metadata: Metadata = { title: seitentitel("/app/uebersicht") };

export default function UebersichtPage() {
  return <Platzhalter pfad="/app/uebersicht" meilenstein={3} alteSeite="/statistics" />;
}

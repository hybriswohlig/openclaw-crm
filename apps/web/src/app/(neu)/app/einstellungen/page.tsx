import type { Metadata } from "next";
import { seitentitel } from "@/components/neu/nav-config";
import { Platzhalter } from "@/components/neu/platzhalter";

export const metadata: Metadata = { title: seitentitel("/app/einstellungen") };

export default function EinstellungenPage() {
  return <Platzhalter pfad="/app/einstellungen" meilenstein={3} alteSeite="/settings" />;
}

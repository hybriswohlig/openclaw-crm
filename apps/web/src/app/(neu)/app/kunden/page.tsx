import type { Metadata } from "next";
import { seitentitel } from "@/components/neu/nav-config";
import { Platzhalter } from "@/components/neu/platzhalter";

export const metadata: Metadata = { title: seitentitel("/app/kunden") };

export default function KundenPage() {
  return <Platzhalter pfad="/app/kunden" meilenstein={3} alteSeite="/objects/people" />;
}

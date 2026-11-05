import type { Metadata } from "next";
import { seitentitel } from "@/components/neu/nav-config";
import { Platzhalter } from "@/components/neu/platzhalter";

export const metadata: Metadata = { title: seitentitel("/app/kasse") };

export default function KassePage() {
  return <Platzhalter pfad="/app/kasse" meilenstein={3} alteSeite="/financial" />;
}

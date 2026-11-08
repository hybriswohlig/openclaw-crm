import type { Metadata } from "next";
import { KasseSeite } from "@/components/neu/kasse/kasse-seite";
import { seitentitel } from "@/components/neu/nav-config";

export const metadata: Metadata = { title: seitentitel("/app/kasse") };

/** Kasse (Plan 9): Warteschlangen für Geld, das noch offen ist. */
export default function KassePage() {
  return <KasseSeite />;
}

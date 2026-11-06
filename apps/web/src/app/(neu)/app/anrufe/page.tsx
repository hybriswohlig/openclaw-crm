import type { Metadata } from "next";
import { AnrufeSeite } from "@/components/neu/anrufe/anrufe-seite";
import { seitentitel } from "@/components/neu/nav-config";

export const metadata: Metadata = { title: seitentitel("/app/anrufe") };

/** Die letzten Telefonate mit Transkript (Gruppe „Mehr“). */
export default function AnrufePage() {
  return <AnrufeSeite />;
}

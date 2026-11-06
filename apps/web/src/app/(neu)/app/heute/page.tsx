import type { Metadata } from "next";
import { Suspense } from "react";
import { HeuteSeite } from "@/components/neu/heute/heute-seite";
import { seitentitel } from "@/components/neu/nav-config";

export const metadata: Metadata = { title: seitentitel("/app/heute") };

/** Startseite der neuen Oberfläche (Plan 8): Chips, Inbox „Jetzt“, Termine heute und morgen, Meldungen, Freigaben. */
export default function HeutePage() {
  return (
    <Suspense fallback={null}>
      <HeuteSeite />
    </Suspense>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { KundenSeite } from "@/components/neu/kunden/kunden-seite";
import { seitentitel } from "@/components/neu/nav-config";

export const metadata: Metadata = { title: seitentitel("/app/kunden") };

/** Kunden (Plan 11): Suche, Kunden, Anfragen und Deals ohne Kunde. Ansicht und Suche in der URL. */
export default function KundenPage() {
  return (
    <Suspense fallback={null}>
      <KundenSeite />
    </Suspense>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { seitentitel } from "@/components/neu/nav-config";
import { PlanSeite } from "@/components/neu/plan/plan-seite";

export const metadata: Metadata = { title: seitentitel("/app/plan") };

/** Plan der neuen Oberfläche (Plan 8): Monat, Woche, Tag. Zustand in der URL, Modus je Nutzer gespeichert. */
export default function PlanPage() {
  return (
    <Suspense fallback={null}>
      <PlanSeite />
    </Suspense>
  );
}

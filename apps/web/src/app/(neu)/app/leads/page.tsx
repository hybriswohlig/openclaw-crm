import type { Metadata } from "next";
import { Suspense } from "react";
import { LeadsSeite } from "@/components/neu/leads/leads-seite";
import { seitentitel } from "@/components/neu/nav-config";

export const metadata: Metadata = { title: seitentitel("/app/leads") };

/** Leads-Board und Liste der neuen Oberfläche (Plan 7). Filter in der URL, Ansicht je Nutzer gespeichert. */
export default function LeadsPage() {
  return (
    <Suspense fallback={null}>
      <LeadsSeite />
    </Suspense>
  );
}

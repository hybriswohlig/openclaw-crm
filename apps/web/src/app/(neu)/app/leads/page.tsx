import type { Metadata } from "next";
import { LeadSuche } from "@/components/neu/lead-suche";
import { seitentitel } from "@/components/neu/nav-config";
import { Platzhalter } from "@/components/neu/platzhalter";

export const metadata: Metadata = { title: seitentitel("/app/leads") };

export default function LeadsPage() {
  return (
    <>
      <Platzhalter pfad="/app/leads" meilenstein={2} alteSeite="/objects/deals" />
      <LeadSuche />
    </>
  );
}

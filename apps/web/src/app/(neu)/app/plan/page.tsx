import type { Metadata } from "next";
import { seitentitel } from "@/components/neu/nav-config";
import { Platzhalter } from "@/components/neu/platzhalter";

export const metadata: Metadata = { title: seitentitel("/app/plan") };

export default function PlanPage() {
  return <Platzhalter pfad="/app/plan" meilenstein={2} alteSeite="/contract-calendar" />;
}

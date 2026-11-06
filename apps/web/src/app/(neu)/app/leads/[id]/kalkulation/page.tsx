import type { Metadata } from "next";
import { KalkSeite } from "@/components/neu/kalkulation/kalk-seite";

export const metadata: Metadata = { title: "Kalkulation" };

/** Die Kalkulationsseite eines Deals (Plan 4, Entscheidung 1: Route /app/leads/[id]/kalkulation). */
export default async function KalkulationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <KalkSeite dealId={id} />;
}

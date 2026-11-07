import type { Metadata } from "next";
import { AkteSeite } from "@/components/neu/akte/akte-seite";
import { AkteZurueck } from "@/components/neu/akte/akte-zurueck";

export const metadata: Metadata = { title: "Akte" };

/** Die Umzugsakte eines Deals (Plan 3, Entscheidung 1: Route /app/leads/[id]). Am Handy oben „‹ Leads“ (Plan 10). */
export default async function AktePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <AkteZurueck />
      <AkteSeite dealId={id} />
    </>
  );
}

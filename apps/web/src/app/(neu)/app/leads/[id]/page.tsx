import type { Metadata } from "next";
import { AkteSeite } from "@/components/neu/akte/akte-seite";

export const metadata: Metadata = { title: "Akte" };

/** Die Umzugsakte eines Deals (Plan 3, Entscheidung 1: Route /app/leads/[id]). */
export default async function AktePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AkteSeite dealId={id} />;
}

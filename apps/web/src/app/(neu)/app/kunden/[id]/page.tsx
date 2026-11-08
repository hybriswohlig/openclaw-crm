import type { Metadata } from "next";
import { Kundenakte } from "@/components/neu/kunden/kundenakte";

export const metadata: Metadata = { title: "Kunde" };

/** Kundenakte (Plan 11, Entscheidung 14). */
export default async function KundenaktePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Kundenakte personId={id} />;
}

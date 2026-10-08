/** Welches KV-PDF „KV ansehen“ in der Lagekarte öffnet. */
import { angezeigtesKvDokument } from "@/lib/portal-dokumente";
import type { KvDokumentStand } from "@/lib/lagekarte/typen";

export function kvDokument(e: {
  angenommenDokumentId: string | null;
  angenommen: boolean;
  quotationUpdatedAt: Date | null;
  /** Nur document_type 'quotation', beliebige Reihenfolge. */
  docs: Array<{ id: string; uploadedAt: Date }>;
}): { dokumentId: string | null; dokumentStand: KvDokumentStand } {
  // Neuestes PDF, das nicht älter als das Angebot ist (ohne Angebotsstand: neuestes überhaupt).
  const grenze = e.quotationUpdatedAt?.getTime() ?? null;
  let aktuell: { id: string; uploadedAt: Date } | null = null;
  for (const doc of e.docs) {
    if (grenze !== null && doc.uploadedAt.getTime() < grenze) continue;
    if (!aktuell || doc.uploadedAt.getTime() > aktuell.uploadedAt.getTime()) aktuell = doc;
  }

  if (e.angenommen) {
    const gewaehlt = angezeigtesKvDokument({
      quotationDocumentId: e.angenommenDokumentId,
      angenommen: true,
      docRows: e.docs,
      aktuellesKv: aktuell,
    });
    if (!gewaehlt) return { dokumentId: null, dokumentStand: e.docs.length > 0 ? "veraltet" : "keins" };
    const gebunden = e.angenommenDokumentId !== null && gewaehlt.id === e.angenommenDokumentId;
    return { dokumentId: gewaehlt.id, dokumentStand: gebunden ? "angenommen" : "aktuell" };
  }

  if (aktuell) return { dokumentId: aktuell.id, dokumentStand: "aktuell" };
  return { dokumentId: null, dokumentStand: e.docs.length > 0 ? "veraltet" : "keins" };
}

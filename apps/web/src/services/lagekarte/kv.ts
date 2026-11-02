/** Welches KV-PDF „KV ansehen“ in der Lagekarte öffnet. */
import { angezeigtesKvDokument, neuestesKvDokument } from "@/lib/portal-dokumente";
import type { KvDokumentStand } from "@/lib/lagekarte/typen";

export function kvDokument(e: {
  angenommenDokumentId: string | null;
  angenommen: boolean;
  /** Nur document_type 'quotation', beliebige Reihenfolge. */
  docs: Array<{ id: string; uploadedAt: Date }>;
}): { dokumentId: string | null; dokumentStand: KvDokumentStand } {
  // Dieselbe Datei wie im Portal: neuestes KV, auch wenn das Angebot danach gespeichert wurde.
  const aktuell = neuestesKvDokument(e.docs);

  if (e.angenommen) {
    const gewaehlt = angezeigtesKvDokument({
      quotationDocumentId: e.angenommenDokumentId,
      angenommen: true,
      docRows: e.docs,
      aktuellesKv: aktuell,
    });
    if (!gewaehlt) return { dokumentId: null, dokumentStand: "keins" };
    const gebunden = e.angenommenDokumentId !== null && gewaehlt.id === e.angenommenDokumentId;
    return { dokumentId: gewaehlt.id, dokumentStand: gebunden ? "angenommen" : "aktuell" };
  }

  if (aktuell) return { dokumentId: aktuell.id, dokumentStand: "aktuell" };
  return { dokumentId: null, dokumentStand: "keins" };
}

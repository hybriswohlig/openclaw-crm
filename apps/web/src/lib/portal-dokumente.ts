/**
 * Reine Regeln, welches Dokument das Kundenportal zeigt und welche
 * Auftragsart ein KV-Auftrag auf dem Angebot hinterlegt.
 */
import type { ServiceArt } from "@openclaw-crm/customer-portal-core";

interface Dok {
  id: string;
  uploadedAt: Date;
}

/**
 * Nach der Annahme das gebundene PDF. Hat die Annahme keins (Altbestand
 * oder kein aktuelles PDF beim Klick), gilt die normale Regel weiter.
 */
export function angezeigtesKvDokument<T extends Dok>(input: {
  quotationDocumentId: string | null;
  angenommen: boolean;
  docRows: T[];
  aktuellesKv: T | null;
}): T | null {
  if (input.angenommen && input.quotationDocumentId) {
    return input.docRows.find((d) => d.id === input.quotationDocumentId) ?? input.aktuellesKv;
  }
  return input.aktuellesKv;
}

/**
 * Eine Auftragsbestätigung aus der Zeit vor einem „Annahme aufheben“ gehört
 * zum alten Stand: Sie zählt weder für die Stufe noch wird sie angezeigt,
 * sonst landet der Kunde in Stufe 2 und kann nicht neu annehmen.
 */
export function gueltigeAuftragsbestaetigung<T extends Dok>(ab: T | null | undefined, aufgehobenAm: Date | null): T | null {
  if (!ab) return null;
  if (aufgehobenAm && ab.uploadedAt <= aufgehobenAm) return null;
  return ab;
}

/** Beim Erzeugen eines KV die gewählte Auftragsart am Angebot speichern. */
export function serviceTypeZuSpeichern(input: {
  documentType: unknown;
  gewaehlt: ServiceArt;
  gespeichert: string | null | undefined;
  angenommen: boolean;
}): ServiceArt | null {
  if (input.documentType !== "KV" || input.angenommen) return null;
  return input.gespeichert === input.gewaehlt ? null : input.gewaehlt;
}

/** Der VPS kennt nur Umzug und Küche; Entrümpelung rendert im Umzugs-Layout. */
export function vpsLeistungsart(art: ServiceArt): "move" | "kitchen_installation" {
  return art === "kitchen_installation" ? "kitchen_installation" : "move";
}

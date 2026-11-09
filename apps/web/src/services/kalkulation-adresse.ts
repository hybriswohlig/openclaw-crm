/**
 * Plan 15, Bauteile 2 und 8: Belade- oder Entladeadresse aus der Kalkulation ins
 * Lead schreiben. Derselbe Weg wie jede Lead-Änderung (`updateRecord` auf dem
 * Deal-Attribut `move_from_address` bzw. `move_to_address`, wie PATCH
 * /objects/deals/records), danach die alte Kalkulationskarte anstoßen. Dazu ein
 * Ereignis `kalkulation.adresse_gesetzt` für die Herkunft „Kalkulation, Name, Zeit“.
 */
import { addressStringToLocationValue } from "@/lib/adresse";
import { ADRESSE_GESETZT_EVENT, type AdresseGesetztPayload } from "@/lib/kalkulation-p15";

export const ADRESSE_SLUG = { beladen: "move_from_address", entladen: "move_to_address" } as const;

export class AdressFehler extends Error {}

/** Prüft die Eingabe; wirft `AdressFehler` mit Text für 400. */
export function pruefeAdressEingabe(body: unknown): AdresseGesetztPayload {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (b.seite !== "beladen" && b.seite !== "entladen") throw new AdressFehler("seite muss beladen oder entladen sein");
  const adresse = typeof b.adresse === "string" ? b.adresse.replace(/\s+/g, " ").trim() : "";
  if (adresse.length < 4 || adresse.length > 200) throw new AdressFehler("Adresse fehlt oder ist zu lang (4 bis 200 Zeichen)");
  if (!/\d{5}|\p{L}{3,}/u.test(adresse)) throw new AdressFehler("Adresse braucht mindestens PLZ oder Ort");
  const quelle = b.quelle === "chat" ? "chat" : "kalkulation";
  const version = typeof b.version === "number" && Number.isInteger(b.version) && b.version > 0 ? b.version : null;
  return { seite: b.seite, adresse, quelle, version };
}

export async function adresseInsLead(ws: string, deal: string, e: AdresseGesetztPayload, userId: string | null): Promise<void> {
  const { getObjectBySlug } = await import("@/services/objects");
  const { updateRecord } = await import("@/services/records");
  const { emitEvent } = await import("@/services/activity-events");
  const { kalkulationAnstossen } = await import("@/services/rechner/ausloeser");
  const obj = await getObjectBySlug(ws, "deals");
  if (!obj) throw new AdressFehler("Deal-Objekt fehlt");
  const rec = await updateRecord(obj.id, deal, { [ADRESSE_SLUG[e.seite]]: addressStringToLocationValue(e.adresse) }, userId);
  if (!rec) throw new AdressFehler("Deal nicht gefunden");
  await emitEvent({ workspaceId: ws, recordId: deal, objectSlug: "deals", eventType: ADRESSE_GESETZT_EVENT, payload: { ...e }, actorId: userId });
  kalkulationAnstossen(ws, deal);
}

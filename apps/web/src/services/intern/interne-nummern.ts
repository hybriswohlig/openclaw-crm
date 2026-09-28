/**
 * Interne WhatsApp-Nummern (Inhaber, Partner): Sie bekommen Freigaben und
 * Alarme und werden nie als Kontakt, Chat oder Lead angelegt.
 *
 * Einstellung `intern_whatsapp_nummern` (workspace_settings, Klartext), JSON:
 *   [{ "name": "Dario", "nummer": "+6588913364", "lids": ["…@lid"] }]
 * `lids` ist optional: WhatsApp liefert manche Absender nur als verschleierte
 * LID statt Telefonnummer; die hier eingetragenen LIDs gelten ebenfalls als intern.
 */
import { canonicalizePhone } from "@/lib/identity/canonical";
import { getSetting } from "@/services/workspace-settings";

export const INTERNE_NUMMERN_KEY = "intern_whatsapp_nummern";

export interface InterneNummer {
  name: string;
  /** Nur Ziffern, Ländervorwahl ohne + */
  ziffern: string;
  /** LID-Ziffern ohne @lid */
  lids: string[];
}

export function nurZiffern(wert: string): string {
  return wert.replace(/\D/g, "");
}

/** Lokaler Teil einer JID ohne Domain und Geräte-Endung ("123:4@lid" → "123"). */
function lokalTeil(jid: string): string {
  return jid.replace(/@.*$/, "").replace(/:\d+$/, "");
}

function istLidJid(jid: string | null | undefined): jid is string {
  return !!jid && /@(hosted\.)?lid$/i.test(jid);
}

/** Telefonnummer als Ziffern (E.164 ohne +), null wenn keine gültige Nummer. */
function telefonZiffern(roh: string): string | null {
  // Geräte-Endung ("…:12", auch vor "@") abschneiden, bevor die Nummer geparst wird.
  const e164 = canonicalizePhone(roh.trim().replace(/:\d+(?=@|$)/, ""));
  return e164 ? nurZiffern(e164) : null;
}

export function interneNummernAus(roh: string | null | undefined): InterneNummer[] {
  if (!roh) return [];
  let daten: unknown;
  try {
    daten = JSON.parse(roh);
  } catch {
    return [];
  }
  if (!Array.isArray(daten)) return [];
  const liste: InterneNummer[] = [];
  for (const e of daten) {
    if (!e || typeof e !== "object") continue;
    const { name, nummer, lids } = e as Record<string, unknown>;
    if (typeof name !== "string" || name.trim() === "" || typeof nummer !== "string") continue;
    const ziffern = telefonZiffern(nummer);
    if (!ziffern) continue;
    liste.push({
      name: name.trim(),
      ziffern,
      lids: Array.isArray(lids)
        ? lids.filter((l): l is string => typeof l === "string").map((l) => nurZiffern(lokalTeil(l))).filter((l) => l.length >= 6)
        : [],
    });
  }
  return liste;
}

/**
 * Die interne Person hinter einem WhatsApp-Absender oder -Empfänger, sonst null.
 * Telefonnummern werden nur mit Telefonnummern verglichen, LIDs nur mit den
 * hinterlegten LIDs: eine LID, deren Ziffern zufällig einer Nummer gleichen,
 * darf nie treffen (sonst würde eine Kundennachricht verschluckt).
 */
export function findeInterne(
  liste: readonly InterneNummer[],
  peer: { peerWaId: string; peerJid?: string | null; peerLid?: string | null }
): InterneNummer | null {
  const lids = new Set<string>();
  if (istLidJid(peer.peerLid)) lids.add(nurZiffern(lokalTeil(peer.peerLid)));
  if (istLidJid(peer.peerJid)) lids.add(nurZiffern(lokalTeil(peer.peerJid)));

  const telefone = new Set<string>();
  // peerWaId ist die LID selbst, wenn die Brücke keine Nummer auflösen konnte.
  if (!lids.has(nurZiffern(peer.peerWaId))) {
    const t = telefonZiffern(peer.peerWaId);
    if (t) telefone.add(t);
  }
  if (peer.peerJid && !istLidJid(peer.peerJid)) {
    const t = telefonZiffern(peer.peerJid);
    if (t) telefone.add(t);
  }
  return liste.find((n) => telefone.has(n.ziffern) || n.lids.some((l) => lids.has(l))) ?? null;
}

export async function ladeInterneNummern(workspaceId: string): Promise<InterneNummer[]> {
  return interneNummernAus(await getSetting(workspaceId, INTERNE_NUMMERN_KEY));
}

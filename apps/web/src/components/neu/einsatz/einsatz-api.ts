/**
 * Aufrufe des Einsatz-Dialogs. Gespeichert wird nur über `PUT …/einsatz`
 * („Team bestätigen“) und die Übersteuerung „Anfahrt Team“.
 */
import { apiAufruf, jsonAufruf, type ApiAntwort } from "@/components/neu/akte/api";
import type { DoppelKonflikt, EinsatzKarte, Zuteilung } from "@/lib/einsatz";
import type { CrewAnsprechpartnerAnsicht, CrewAusschreibungAnsicht, CrewBriefingAnsicht, EinsatzAnsicht, EinsatzBestaetigenBody } from "@/lib/einsatz-ansicht";

export function einsatzLaden(dealId: string, frisch = false): Promise<ApiAntwort<EinsatzAnsicht>> {
  return apiAufruf<EinsatzAnsicht>(`/api/v1/deals/${encodeURIComponent(dealId)}/einsatz${frisch ? "?frisch=1" : ""}`);
}

/** 12c: Karten-Ansicht, erst beim ersten Umschalten geladen (Geocoding nur dann). */
export function ladeKarte(dealId: string): Promise<ApiAntwort<EinsatzKarte>> {
  return apiAufruf<EinsatzKarte>(`/api/v1/deals/${encodeURIComponent(dealId)}/einsatz/karte`);
}

export type BestaetigenAntwort =
  | { ok: true; team: Zuteilung[]; benachrichtigt: { gesendet: number; gesamt: number } | null }
  | { ok: false; status: number; code: string | null; message: string; konflikte: DoppelKonflikt[] };

export async function teamBestaetigen(dealId: string, body: EinsatzBestaetigenBody): Promise<BestaetigenAntwort> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/deals/${encodeURIComponent(dealId)}/einsatz`, jsonAufruf("PUT", body));
  } catch {
    return { ok: false, status: 0, code: null, message: "Keine Verbindung zum Server.", konflikte: [] };
  }
  const json = (await res.json().catch(() => null)) as
    | { data?: { team: Zuteilung[]; benachrichtigt?: { gesendet: number; gesamt: number } | null }; error?: { code?: string; message?: string; konflikte?: DoppelKonflikt[] } }
    | null;
  if (res.ok && json?.data) return { ok: true, team: json.data.team, benachrichtigt: json.data.benachrichtigt ?? null };
  return {
    ok: false,
    status: res.status,
    code: json?.error?.code ?? null,
    message: json?.error?.message ?? `Der Server hat mit Fehler ${res.status} geantwortet.`,
    konflikte: Array.isArray(json?.error?.konflikte) ? json!.error!.konflikte! : [],
  };
}

/** „Anfahrt Team“ als Übersteuerung mit Grund in die Kalkulation (E7). */
export function anfahrtUebernehmen(dealId: string, version: number, euro: number, grund: string) {
  return apiAufruf<{ version: number; neu: boolean }>(
    `/api/v1/deals/${encodeURIComponent(dealId)}/calculation/versions/${version}/overrides`,
    jsonAufruf("POST", { art: "eingabe", key: "anfahrt_team", wert: Math.round(euro * 100) / 100, grund }),
  );
}

export const EINSATZ_DIALOG_EVENT = "neu:einsatz-dialog-oeffnen";

export function einsatzDialogOeffnen(dealId: string): void {
  window.dispatchEvent(new CustomEvent(EINSATZ_DIALOG_EVENT, { detail: { dealId } }));
}

/** Crew-Portal: gesuchte Leute (null = Kalkulation) und Ausschreiben; sofort gespeichert. */
export function crewAusschreibungSetzen(dealId: string, body: { leute?: number | null; ausschreiben?: boolean }) {
  return apiAufruf<CrewAusschreibungAnsicht>(`/api/v1/deals/${encodeURIComponent(dealId)}/einsatz/crew`, jsonAufruf("PATCH", body));
}

/** Crew-Portal: Briefing (erneut) freigeben, auf Wunsch mit WhatsApp ans Team, oder zurückziehen. */
export function crewBriefingAktion(dealId: string, body: { aktion: "freigeben"; whatsapp: boolean } | { aktion: "zurueckziehen" }) {
  return apiAufruf<CrewBriefingAnsicht>(`/api/v1/deals/${encodeURIComponent(dealId)}/einsatz/briefing`, jsonAufruf("POST", body));
}

/** Crew-Portal: Ansprechpartner fürs Team (null = Standard), optional zugleich als Standard. */
export function crewAnsprechpartnerSetzen(dealId: string, body: { employeeId: string | null; alsStandard?: boolean }) {
  return apiAufruf<CrewAnsprechpartnerAnsicht>(`/api/v1/deals/${encodeURIComponent(dealId)}/einsatz/ansprechpartner`, jsonAufruf("PUT", body));
}

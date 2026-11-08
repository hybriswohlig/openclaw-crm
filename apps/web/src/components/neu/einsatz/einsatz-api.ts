/**
 * Aufrufe des Einsatz-Dialogs. Gespeichert wird nur über `PUT …/einsatz`
 * („Team bestätigen“) und die Übersteuerung „Anfahrt Team“.
 */
import { apiAufruf, jsonAufruf, type ApiAntwort } from "@/components/neu/akte/api";
import type { DoppelKonflikt, Zuteilung } from "@/lib/einsatz";
import type { EinsatzAnsicht, EinsatzBestaetigenBody } from "@/lib/einsatz-ansicht";

export function einsatzLaden(dealId: string, frisch = false): Promise<ApiAntwort<EinsatzAnsicht>> {
  return apiAufruf<EinsatzAnsicht>(`/api/v1/deals/${encodeURIComponent(dealId)}/einsatz${frisch ? "?frisch=1" : ""}`);
}

export type BestaetigenAntwort =
  | { ok: true; team: Zuteilung[] }
  | { ok: false; status: number; code: string | null; message: string; konflikte: DoppelKonflikt[] };

export async function teamBestaetigen(dealId: string, body: EinsatzBestaetigenBody): Promise<BestaetigenAntwort> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/deals/${encodeURIComponent(dealId)}/einsatz`, jsonAufruf("PUT", body));
  } catch {
    return { ok: false, status: 0, code: null, message: "Keine Verbindung zum Server.", konflikte: [] };
  }
  const json = (await res.json().catch(() => null)) as
    | { data?: { team: Zuteilung[] }; error?: { code?: string; message?: string; konflikte?: DoppelKonflikt[] } }
    | null;
  if (res.ok && json?.data) return { ok: true, team: json.data.team };
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

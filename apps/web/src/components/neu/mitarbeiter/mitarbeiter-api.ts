/**
 * Aufrufe der Seite Mitarbeiter (Plan 12a Task E) gegen `/api/v1/einsatz/*`.
 * PLZ und Ort kommen nur hier vor, nie über `/api/v1/employees`.
 */
import { apiAufruf, jsonAufruf, type ApiAntwort } from "@/components/neu/akte/api";
import type { Abwesenheit, AbwesenheitArt, EinsatzPerson, KapazitaetTag, StammdatenEingabe } from "@/lib/einsatz";
import type { PlanAntwort } from "@/lib/plan-heute";

export function personenLaden(): Promise<ApiAntwort<EinsatzPerson[]>> {
  return apiAufruf<EinsatzPerson[]>("/api/v1/einsatz/mitarbeiter");
}

export function personAnlegen(e: StammdatenEingabe): Promise<ApiAntwort<EinsatzPerson>> {
  return apiAufruf<EinsatzPerson>("/api/v1/einsatz/mitarbeiter", jsonAufruf("POST", e));
}

export function personAendern(id: string, e: StammdatenEingabe): Promise<ApiAntwort<EinsatzPerson>> {
  return apiAufruf<EinsatzPerson>(`/api/v1/einsatz/mitarbeiter/${encodeURIComponent(id)}`, jsonAufruf("PATCH", e));
}

export function abwesenheitenLaden(id: string): Promise<ApiAntwort<Abwesenheit[]>> {
  return apiAufruf<Abwesenheit[]>(`/api/v1/einsatz/mitarbeiter/${encodeURIComponent(id)}/abwesenheiten`);
}

export function abwesenheitAnlegen(
  id: string,
  e: { von: string; bis: string; art: AbwesenheitArt; notiz: string | null },
): Promise<ApiAntwort<Abwesenheit>> {
  return apiAufruf<Abwesenheit>(`/api/v1/einsatz/mitarbeiter/${encodeURIComponent(id)}/abwesenheiten`, jsonAufruf("POST", e));
}

export function abwesenheitLoeschen(id: string): Promise<ApiAntwort<{ id: string }>> {
  return apiAufruf<{ id: string }>(`/api/v1/einsatz/abwesenheiten/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Kapazität der nächsten Tage aus dem Plan (eine Quelle mit Plan und Termin-Dialog). */
export async function kapazitaetLaden(von: string, bis: string): Promise<ApiAntwort<KapazitaetTag[]>> {
  const r = await apiAufruf<PlanAntwort>(`/api/v1/plan?von=${von}&bis=${bis}`);
  return r.ok ? { ok: true, data: r.data.kapazitaet ?? [] } : r;
}

/**
 * Aufrufe rund um Transporter-Buchungen (Plan 12b) für Plan, Reiter
 * „Transporter“ und Einsatz-Dialog.
 */
import { apiAufruf, jsonAufruf, type ApiAntwort } from "@/components/neu/akte/api";
import type { BuchungEingabe, BuchungZuordnung, TransporterBuchung } from "@/lib/einsatz";

export type BuchungVoll = TransporterBuchung & { zuordnungen: BuchungZuordnung[]; text: string; warnungen: string[] };

export interface RechnerStation {
  id: string;
  name: string;
  anbieter: string | null;
  aktiv: boolean;
}

export interface RechnerKlasse {
  id: string;
  name: string;
  typ: string;
  anbieter: string | null;
  aktiv: boolean;
  mietpreisWochentage: Record<string, number> | null;
  inklusivKmProTag: number | null;
  mehrkilometerPreis: number | null;
}

export function buchungenLaden(von: string, bis: string, firma?: string | null): Promise<ApiAntwort<BuchungVoll[]>> {
  const q = new URLSearchParams({ von, bis });
  if (firma) q.set("firma", firma);
  return apiAufruf<BuchungVoll[]>(`/api/v1/einsatz/buchungen?${q.toString()}`);
}

export async function buchungLaden(b: { id: string; von: string; bis: string }): Promise<ApiAntwort<BuchungVoll | null>> {
  const r = await buchungenLaden(b.von, b.bis);
  return r.ok ? { ok: true, data: r.data.find((x) => x.id === b.id) ?? null } : r;
}

export function buchungAnlegen(e: BuchungEingabe): Promise<ApiAntwort<TransporterBuchung>> {
  return apiAufruf<TransporterBuchung>("/api/v1/einsatz/buchungen", jsonAufruf("POST", e));
}

export function buchungAendern(id: string, e: Partial<BuchungEingabe>): Promise<ApiAntwort<{ buchung: TransporterBuchung; warnungen: string[] }>> {
  return apiAufruf(`/api/v1/einsatz/buchungen/${encodeURIComponent(id)}`, jsonAufruf("PATCH", e));
}

export function dealZuordnen(id: string, dealId: string): Promise<ApiAntwort<{ warnungen: string[] }>> {
  return apiAufruf(`/api/v1/einsatz/buchungen/${encodeURIComponent(id)}/deals/${encodeURIComponent(dealId)}`, { method: "PUT" });
}

export function dealLoesen(id: string, dealId: string): Promise<ApiAntwort<{ geloest: boolean }>> {
  return apiAufruf(`/api/v1/einsatz/buchungen/${encodeURIComponent(id)}/deals/${encodeURIComponent(dealId)}`, { method: "DELETE" });
}

export function stammdatenLaden(): Promise<ApiAntwort<{ stationen: RechnerStation[]; klassen: RechnerKlasse[] }>> {
  return apiAufruf("/api/v1/einsatz/rechner-stammdaten");
}

export function firmenSchalterLaden(ocId: string): Promise<ApiAntwort<{ buchungImPreis: boolean }>> {
  return apiAufruf(`/api/v1/einsatz/firmen/${encodeURIComponent(ocId)}`);
}

export function firmenSchalterSetzen(ocId: string, buchungImPreis: boolean): Promise<ApiAntwort<{ buchungImPreis: boolean }>> {
  return apiAufruf(`/api/v1/einsatz/firmen/${encodeURIComponent(ocId)}`, jsonAufruf("PUT", { buchungImPreis }));
}

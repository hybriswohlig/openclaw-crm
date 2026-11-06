/**
 * Der eine Schreibweg für einen Tag aus dem Plan (Entscheidungen 7 und 9):
 * `PATCH /api/v1/objects/deals/records/{id}` mit `x-crm-client: ui` wie
 * `stufeSetzen`, nur mit dem Datumsfeld (`move_date` bzw. dem
 * Besichtigungsfeld). Die Kalkulation stößt der Server dort wie bisher an.
 * Liefert die Fehlermeldung, sonst null.
 */
import { apiAufruf, jsonAufruf } from "@/components/neu/akte/api";
import { CRM_UI_CLIENT_HEADER, CRM_UI_CLIENT_VALUE } from "@/lib/deal-source";

export async function terminSetzen(dealId: string, werte: Record<string, string>): Promise<string | null> {
  const r = await apiAufruf<unknown>(
    `/api/v1/objects/deals/records/${encodeURIComponent(dealId)}`,
    jsonAufruf("PATCH", { values: werte }, { [CRM_UI_CLIENT_HEADER]: CRM_UI_CLIENT_VALUE })
  );
  return r.ok ? null : r.message;
}

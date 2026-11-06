/**
 * Der eine Schreibweg für einen Stufenwechsel aus der neuen Oberfläche
 * (Akte, Leads-Board, Kartenmenü): `PATCH /api/v1/objects/deals/records/{id}`
 * mit `x-crm-client: ui`, damit der Server den Verlustgrund verlangt und
 * `deal.stage_changed`, `move_completed_at` und Wartet wie in der alten
 * Oberfläche laufen. Liefert die Fehlermeldung, sonst null.
 */
import { CRM_UI_CLIENT_HEADER, CRM_UI_CLIENT_VALUE } from "@/lib/deal-source";
import { apiAufruf, jsonAufruf } from "@/components/neu/akte/api";

export async function stufeSetzen(
  dealId: string,
  stufeId: string,
  verlust?: { grund: string; notiz: string }
): Promise<string | null> {
  const werte: Record<string, unknown> = { stage: stufeId };
  if (verlust) {
    werte.loss_reason = verlust.grund;
    werte.loss_reason_note = verlust.notiz || null;
  }
  const r = await apiAufruf<unknown>(
    `/api/v1/objects/deals/records/${dealId}`,
    jsonAufruf("PATCH", { values: werte }, { [CRM_UI_CLIENT_HEADER]: CRM_UI_CLIENT_VALUE })
  );
  return r.ok ? null : r.message;
}

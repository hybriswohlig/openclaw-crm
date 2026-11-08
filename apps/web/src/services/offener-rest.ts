import { offenAus, type OffenErgebnis } from "@/lib/geld";
import { ladeAktiveAnnahme } from "./kva-annahme";
import { getQuotation } from "./quotations";
import { listPayments } from "./financial";
import { aktiveRechnung } from "./rechnungen";

/**
 * Der eine offene Rest eines Deals (Plan 9, Entscheidung 3): gestellte
 * Rechnung mit Betrag vor Stunden-KV vor Annahme vor Festpreis.
 */
export async function offenerRest(workspaceId: string, dealRecordId: string): Promise<OffenErgebnis> {
  const [annahme, angebot, zahlungen, rechnung] = await Promise.all([
    ladeAktiveAnnahme(dealRecordId),
    getQuotation(dealRecordId),
    listPayments(dealRecordId),
    aktiveRechnung(workspaceId, dealRecordId),
  ]);
  return offenAus({
    rechnung: rechnung ? { status: rechnung.status, bruttoCent: rechnung.bruttoCent } : null,
    annahmeCent: annahme?.confirmedTotalCents ?? null,
    festpreis: angebot?.fixedPrice ?? null,
    istStunden: angebot?.isVariable ?? false,
    zahlungen: zahlungen
      .filter((z) => z.workspaceId === workspaceId)
      .map((z) => ({ amount: String(z.amount), taxTreatment: z.taxTreatment })),
  });
}

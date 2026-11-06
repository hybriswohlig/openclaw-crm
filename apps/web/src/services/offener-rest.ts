import { restAus } from "@/lib/offener-rest";
import { ladeAktiveAnnahme } from "./kva-annahme";
import { getQuotation } from "./quotations";
import { listPayments } from "./financial";

export async function offenerRest(
  workspaceId: string,
  dealRecordId: string,
): Promise<ReturnType<typeof restAus>> {
  const [annahme, angebot, zahlungen] = await Promise.all([
    ladeAktiveAnnahme(dealRecordId),
    getQuotation(dealRecordId),
    listPayments(dealRecordId),
  ]);
  return restAus({
    annahmeCent: annahme?.confirmedTotalCents ?? null,
    festpreis: angebot?.fixedPrice ?? null,
    istStunden: angebot?.isVariable ?? false,
    zahlungen: zahlungen
      .filter((z) => z.workspaceId === workspaceId)
      .map((z) => ({ amount: String(z.amount), taxTreatment: z.taxTreatment })),
  });
}

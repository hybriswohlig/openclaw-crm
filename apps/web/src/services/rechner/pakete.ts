/** Ob ein Lead Paketoptionen hat (dann bestimmt das gewählte Paket den Angebotspreis im Kundenportal). */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { quotationPackageOptions } from "@/db/schema";

export async function hatPaketoptionen(dealRecordId: string): Promise<boolean> {
  const [zeile] = await db
    .select({ id: quotationPackageOptions.id })
    .from(quotationPackageOptions)
    .where(eq(quotationPackageOptions.dealRecordId, dealRecordId))
    .limit(1);
  return !!zeile;
}

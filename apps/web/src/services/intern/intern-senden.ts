/**
 * Nachrichten an die internen Nummern (intern_whatsapp_nummern) über ein
 * Baileys-Konto, ohne Chat im CRM. Absender: das Konto aus der Einstellung
 * `intern_absender_account_id`, sonst das erste verbundene Baileys-Konto.
 * Fehler je Empfänger werden geloggt, nie geworfen.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { channelAccounts } from "@/db/schema/inbox";
import { getSetting } from "@/services/workspace-settings";
import { sendBaileysDirektText } from "@/services/inbox-whatsapp";
import { ladeInterneNummern } from "./interne-nummern";

export const INTERN_ABSENDER_KEY = "intern_absender_account_id";

async function absenderKonto(workspaceId: string, kontoId?: string | null): Promise<string | null> {
  const gewuenscht = kontoId ?? (await getSetting(workspaceId, INTERN_ABSENDER_KEY));
  const verbunden = (
    await db
      .select({ id: channelAccounts.id, status: channelAccounts.baileysPairingStatus })
      .from(channelAccounts)
      .where(
        and(
          eq(channelAccounts.workspaceId, workspaceId),
          eq(channelAccounts.channelType, "whatsapp"),
          eq(channelAccounts.isActive, true),
          isNull(channelAccounts.waPhoneNumberId)
        )
      )
      .orderBy(asc(channelAccounts.createdAt))
  ).filter((k) => k.status === "connected");
  // Das Wunschkonto nur, solange es verbunden ist; sonst das erste verbundene.
  return verbunden.find((k) => k.id === gewuenscht)?.id ?? verbunden[0]?.id ?? null;
}

/**
 * Sendet an die internen Nummern (alle oder nur die genannten Namen).
 * Liefert je Name, ob zugestellt wurde. Bei hinterlegter LID geht die Nachricht
 * an die LID: ein Versand an die blanke Nummer erreicht auf LID umgestellte
 * Kontakte sonst womöglich nie.
 */
export async function sendeAnInterne(
  workspaceId: string,
  text: string,
  opts: { kontoId?: string | null; nurAn?: readonly string[] } = {}
): Promise<{ zugestellt: string[]; fehlgeschlagen: string[] }> {
  const alle = await ladeInterneNummern(workspaceId);
  const empfaenger = opts.nurAn ? alle.filter((e) => opts.nurAn!.includes(e.name)) : alle;
  const ergebnis = { zugestellt: [] as string[], fehlgeschlagen: [] as string[] };
  if (empfaenger.length === 0) {
    console.warn("[intern-senden] keine internen Nummern eingetragen (intern_whatsapp_nummern)");
    return ergebnis;
  }
  const konto = await absenderKonto(workspaceId, opts.kontoId);
  if (!konto) {
    console.error("[intern-senden] kein verbundenes Baileys-Konto als Absender");
    return { zugestellt: [], fehlgeschlagen: empfaenger.map((e) => e.name) };
  }
  for (const e of empfaenger) {
    try {
      await sendBaileysDirektText({ accountId: konto, peerWaId: e.lids[0] ? `${e.lids[0]}@lid` : e.ziffern, text });
      ergebnis.zugestellt.push(e.name);
    } catch (err) {
      console.error(`[intern-senden] an ${e.name} fehlgeschlagen:`, err instanceof Error ? err.message : err);
      ergebnis.fehlgeschlagen.push(e.name);
    }
  }
  return ergebnis;
}

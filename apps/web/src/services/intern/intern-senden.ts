/**
 * Nachrichten an die internen Nummern (intern_whatsapp_nummern) über ein
 * Baileys-Konto, ohne Chat im CRM. Absender: das Konto aus der Einstellung
 * `intern_absender_account_id`, sonst das erste verbundene Baileys-Konto.
 * Fehler je Empfänger werden geloggt, nie geworfen.
 */
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { channelAccounts } from "@/db/schema/inbox";
import { getSetting } from "@/services/workspace-settings";
import { agentEvents } from "@/db/schema/agent";
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
  opts: { kontoId?: string | null; nurAn?: readonly string[]; nachholen?: boolean } = {}
): Promise<{ zugestellt: string[]; fehlgeschlagen: string[] }> {
  const ergebnis = await sendeEinmal(workspaceId, text, opts);
  if (opts.nachholen && ergebnis.fehlgeschlagen.length > 0) {
    await vormerken(workspaceId, { text, an: ergebnis.fehlgeschlagen, kontoId: opts.kontoId ?? null });
  }
  return ergebnis;
}

async function sendeEinmal(
  workspaceId: string,
  text: string,
  opts: { kontoId?: string | null; nurAn?: readonly string[] }
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
    // Erst an die hinterlegte LID, bei Fehler an die Telefonnummer.
    const ziele = e.lids[0] ? [`${e.lids[0]}@lid`, e.ziffern] : [e.ziffern];
    let ok = false;
    for (const ziel of ziele) {
      try {
        await sendBaileysDirektText({ accountId: konto, peerWaId: ziel, text });
        ok = true;
        break;
      } catch (err) {
        console.error(`[intern-senden] an ${e.name} (${ziel.includes("@lid") ? "LID" : "Nummer"}) fehlgeschlagen:`, err instanceof Error ? err.message : err);
      }
    }
    (ok ? ergebnis.zugestellt : ergebnis.fehlgeschlagen).push(e.name);
  }
  return ergebnis;
}

// ─── Nachhol-Warteschlange ──────────────────────────────────────────────────
// Interne Nachrichten (Freigaben, Übergabe-Infos), die einen Empfänger nicht
// erreicht haben, werden als Ereignis vorgemerkt und vom KI-Wächter-Cron
// (alle 15 Minuten) erneut versucht, höchstens 24 Stunden lang. agent_events
// ist nur anhängbar: Vormerken und Erledigt sind je eine eigene Zeile, so geht
// bei gleichzeitigen Läufen nichts verloren (kein Zurückschreiben einer Liste).
const NACHHOLEN_MAX_MS = 24 * 60 * 60_000;

async function vormerken(
  workspaceId: string,
  eintrag: { text: string; an: string[]; kontoId: string | null }
): Promise<void> {
  try {
    await db.insert(agentEvents).values({
      workspaceId,
      engine: "intern",
      eventType: "intern_nachholen",
      payload: eintrag,
      idempotencyKey: `nachholen:${crypto.randomUUID()}`,
    });
  } catch (err) {
    console.error("[intern-senden] Vormerken fehlgeschlagen:", err);
  }
}

/** Offene interne Nachrichten erneut senden; liefert, wie viele jetzt ankamen. */
export async function nachholenAusstehend(workspaceId: string, jetzt = new Date()): Promise<number> {
  const offen = await db
    .select({ id: agentEvents.id, payload: agentEvents.payload })
    .from(agentEvents)
    .where(
      and(
        eq(agentEvents.workspaceId, workspaceId),
        eq(agentEvents.eventType, "intern_nachholen"),
        gt(agentEvents.createdAt, new Date(jetzt.getTime() - NACHHOLEN_MAX_MS))
      )
    );
  if (offen.length === 0) return 0;
  const erledigt = new Set(
    (
      await db
        .select({ payload: agentEvents.payload })
        .from(agentEvents)
        .where(
          and(
            eq(agentEvents.workspaceId, workspaceId),
            eq(agentEvents.eventType, "intern_nachgeholt"),
            gt(agentEvents.createdAt, new Date(jetzt.getTime() - NACHHOLEN_MAX_MS))
          )
        )
    ).map((e) => {
      const p = e.payload as { bezug?: number; name?: string };
      return `${p.bezug}:${p.name}`;
    })
  );
  let angekommen = 0;
  for (const e of offen) {
    const p = e.payload as { text?: string; an?: string[]; kontoId?: string | null };
    if (!p.text || !Array.isArray(p.an)) continue;
    const noch = p.an.filter((n) => !erledigt.has(`${e.id}:${n}`));
    if (noch.length === 0) continue;
    const { zugestellt } = await sendeEinmal(workspaceId, p.text, { kontoId: p.kontoId ?? null, nurAn: noch });
    for (const name of zugestellt) {
      await db
        .insert(agentEvents)
        .values({
          workspaceId,
          engine: "intern",
          eventType: "intern_nachgeholt",
          payload: { bezug: e.id, name },
          idempotencyKey: `nachgeholt:${e.id}:${name}`,
        })
        .onConflictDoNothing();
      angekommen++;
    }
  }
  return angekommen;
}

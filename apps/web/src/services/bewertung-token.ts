/**
 * Freigabe eines unklaren Bewertungstokens (Plan 11, Entscheidung 8).
 * Nur ungeklickt und in Lage „unklar“ (auch ein „anspruch“, der älter als
 * 10 Minuten ist). Dieselbe Sperre wie die Handstrecke, damit Freigabe und
 * Versand sich nicht überholen.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { reviewEvents, reviewTokens } from "@/db/schema";
import { tokenLage, type TokenZustand } from "@/lib/bewertungen-kunden";

export async function tokenFreigeben(
  ws: string,
  deal: string,
  userId: string,
  jetzt: Date = new Date()
): Promise<{ freigegeben: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('bewertung:' || ${ws} || ':' || ${deal}))`);
    const vorhanden = await tx
      .select({
        token: reviewTokens.token,
        zustand: reviewTokens.zustand,
        createdAt: reviewTokens.createdAt,
        clickedAt: reviewTokens.clickedAt,
      })
      .from(reviewTokens)
      .where(and(eq(reviewTokens.workspaceId, ws), eq(reviewTokens.dealRecordId, deal), isNull(reviewTokens.clickedAt)));

    const frei = vorhanden.filter(
      (t) =>
        tokenLage(
          { zustand: t.zustand as TokenZustand, createdAt: t.createdAt, clickedAt: t.clickedAt },
          jetzt
        ) === "unklar"
    );
    if (frei.length === 0) return { freigegeben: 0 };

    await tx
      .delete(reviewTokens)
      .where(
        and(
          eq(reviewTokens.workspaceId, ws),
          eq(reviewTokens.dealRecordId, deal),
          isNull(reviewTokens.clickedAt),
          inArray(
            reviewTokens.token,
            frei.map((t) => t.token)
          )
        )
      );
    await tx.insert(reviewEvents).values(
      frei.map((t) => ({
        id: randomUUID(),
        workspaceId: ws,
        dealRecordId: deal,
        eventType: "token_freigegeben",
        channel: null,
        meta: { token: t.token, user_id: userId },
      }))
    );
    return { freigegeben: frei.length };
  });
}

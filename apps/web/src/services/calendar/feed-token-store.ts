import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { calendarFeedTokens } from "@/db/schema";
import {
  createFeedTokenService,
  type FeedTokenRecord,
  type FeedTokenStore,
} from "./feed-tokens";

function mapRow(row: typeof calendarFeedTokens.$inferSelect): FeedTokenRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    token: row.token,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

export const drizzleFeedTokenStore: FeedTokenStore = {
  async findByToken(token) {
    const [row] = await db
      .select()
      .from(calendarFeedTokens)
      .where(eq(calendarFeedTokens.token, token))
      .limit(1);
    return row ? mapRow(row) : null;
  },

  async findActiveForUser(workspaceId, userId) {
    const [row] = await db
      .select()
      .from(calendarFeedTokens)
      .where(
        and(
          eq(calendarFeedTokens.workspaceId, workspaceId),
          eq(calendarFeedTokens.userId, userId),
          isNull(calendarFeedTokens.revokedAt)
        )
      )
      .limit(1);
    return row ? mapRow(row) : null;
  },

  async insert(input) {
    try {
      const [row] = await db
        .insert(calendarFeedTokens)
        .values({
          workspaceId: input.workspaceId,
          userId: input.userId,
          token: input.token,
        })
        .returning();
      return mapRow(row);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await drizzleFeedTokenStore.findActiveForUser(
        input.workspaceId,
        input.userId
      );
      if (existing) return existing;
      throw error;
    }
  },

  async revoke(id, at) {
    await db
      .update(calendarFeedTokens)
      .set({ revokedAt: at })
      .where(eq(calendarFeedTokens.id, id));
  },

  async touch(id, at) {
    await db
      .update(calendarFeedTokens)
      .set({ lastUsedAt: at })
      .where(eq(calendarFeedTokens.id, id));
  },
};

export const calendarFeeds = createFeedTokenService(drizzleFeedTokenStore);

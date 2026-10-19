import { randomBytes } from "node:crypto";

export interface FeedTokenRecord {
  id: string;
  workspaceId: string;
  userId: string;
  token: string;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface FeedTokenStore {
  findByToken(token: string): Promise<FeedTokenRecord | null>;
  findActiveForUser(workspaceId: string, userId: string): Promise<FeedTokenRecord | null>;
  insert(input: { workspaceId: string; userId: string; token: string }): Promise<FeedTokenRecord>;
  revoke(id: string, at: Date): Promise<void>;
  touch(id: string, at: Date): Promise<void>;
}

export interface FeedAccess {
  workspaceId: string;
  userId: string;
  tokenId: string;
}

const TOKEN_RE = /^cal_[A-Za-z0-9_-]{20,}$/;

export function generateFeedToken(): string {
  return `cal_${randomBytes(32).toString("base64url")}`;
}

/** Accept `cal_….ics` from the subscription URL and reject anything else. */
export function normalizeFeedTokenParam(raw: string): string | null {
  let value = raw.trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    return null;
  }
  value = value.replace(/\.ics$/i, "");
  if (!TOKEN_RE.test(value)) return null;
  return value;
}

export function feedPath(token: string): string {
  return `/api/calendar/ics/${token}.ics`;
}

export function createFeedTokenService(store: FeedTokenStore) {
  return {
    getActive(workspaceId: string, userId: string) {
      return store.findActiveForUser(workspaceId, userId);
    },

    async getOrCreate(workspaceId: string, userId: string): Promise<FeedTokenRecord> {
      const existing = await store.findActiveForUser(workspaceId, userId);
      if (existing) return existing;
      return store.insert({ workspaceId, userId, token: generateFeedToken() });
    },

    async regenerate(workspaceId: string, userId: string): Promise<FeedTokenRecord> {
      const existing = await store.findActiveForUser(workspaceId, userId);
      if (existing) await store.revoke(existing.id, new Date());
      return store.insert({ workspaceId, userId, token: generateFeedToken() });
    },

    async revokeActive(workspaceId: string, userId: string): Promise<void> {
      const existing = await store.findActiveForUser(workspaceId, userId);
      if (existing) await store.revoke(existing.id, new Date());
    },

    async authenticate(token: string): Promise<FeedAccess | null> {
      const normalized = normalizeFeedTokenParam(token);
      if (!normalized) return null;
      const row = await store.findByToken(normalized);
      if (!row || row.revokedAt) return null;
      try {
        await store.touch(row.id, new Date());
      } catch {
        // A failed stamp must not hide the calendar.
      }
      return { workspaceId: row.workspaceId, userId: row.userId, tokenId: row.id };
    },
  };
}

export type FeedTokenService = ReturnType<typeof createFeedTokenService>;

/**
 * CRM-backed Baileys AuthenticationState.
 *
 * Replaces `useMultiFileAuthState` with a Postgres-backed adapter that
 * proxies through the CRM HTTPS API. The full state (creds + keys) is
 * stored as a single encrypted JSON blob in `workspace_settings` keyed
 * by channelAccountId.
 *
 * Why a single blob instead of one row per signal-key? The blob is
 * tens of KB — well below any DB-row size concern — and round-tripping
 * it as one document means cold-start is one HTTP GET, not N. Writes
 * are debounced (~500ms) so a busy session doesn't hammer the CRM.
 *
 * Buffer + Uint8Array survive the round trip via `BufferJSON.replacer`
 * /`BufferJSON.reviver` from baileys/Utils.
 */
import {
  initAuthCreds,
  BufferJSON,
  proto,
  type AuthenticationState,
  type AuthenticationCreds,
  type SignalDataTypeMap,
  type SignalDataSet,
  type SignalKeyStore,
} from "baileys";
import type { Logger } from "../lib/logger.js";
import type { CrmClient } from "../lib/crm-client.js";

interface KeyMap {
  [type: string]: { [id: string]: unknown };
}

interface FullState {
  creds: AuthenticationCreds;
  keys: KeyMap;
}

const PERSIST_DEBOUNCE_MS = 500;

export interface CrmAuthStateHandle {
  state: AuthenticationState;
  /**
   * Mark the cached state dirty so it gets persisted on the next debounce
   * tick. Bind this to `sock.ev.on('creds.update', ...)` — Baileys mutates
   * `state.creds` in place, so we just need to schedule a write.
   */
  markDirty: () => void;
  /** Force-flush any pending writes (call before shutting the socket). */
  flush: () => Promise<void>;
  /** Wipe the blob in the CRM. Used on `loggedOut`. */
  clear: () => Promise<void>;
}

export async function makeCrmAuthState(params: {
  accountId: string;
  crm: CrmClient;
  log: Logger;
}): Promise<CrmAuthStateHandle> {
  const { accountId, crm, log } = params;

  // Cold-start: pull the existing blob (or null = first-pair).
  const remote = await crm.getAuthState(accountId);
  const initial: FullState = remote
    ? (JSON.parse(JSON.stringify(remote), BufferJSON.reviver) as FullState)
    : { creds: initAuthCreds(), keys: {} };

  // Mutable local copy. Baileys reads/writes creds in place.
  let cached: FullState = initial;

  // Single-flight debounced persistence.
  let persistTimer: NodeJS.Timeout | null = null;
  let inflight: Promise<void> | null = null;
  const schedulePersist = () => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      void persistNow();
    }, PERSIST_DEBOUNCE_MS);
  };
  const persistNow = async (): Promise<void> => {
    if (inflight) {
      // Coalesce — a flush will schedule another after this one returns.
      await inflight;
      schedulePersist();
      return;
    }
    const snapshot = JSON.parse(
      JSON.stringify(cached, BufferJSON.replacer),
    );
    inflight = (async () => {
      try {
        await crm.putAuthState(accountId, snapshot);
      } catch (err) {
        log.error(
          { err, accountId },
          "[crm-auth-state] persist failed; will retry on next change",
        );
      } finally {
        inflight = null;
      }
    })();
    await inflight;
  };

  const keys: SignalKeyStore = {
    get: async <T extends keyof SignalDataTypeMap>(
      type: T,
      ids: string[],
    ): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
      const bucket = cached.keys[type as string] ?? {};
      const out: { [id: string]: SignalDataTypeMap[T] } = {};
      for (const id of ids) {
        let value = bucket[id];
        if (value == null) continue;
        // Baileys requires app-state-sync-key values to be reified into
        // the proto class. Mirror what useMultiFileAuthState does.
        if (type === "app-state-sync-key") {
          value = proto.Message.AppStateSyncKeyData.fromObject(
            value as object,
          );
        }
        out[id] = value as SignalDataTypeMap[T];
      }
      return out;
    },
    set: async (data: SignalDataSet): Promise<void> => {
      let dirty = false;
      for (const category in data) {
        const items = data[category as keyof SignalDataSet];
        if (!items) continue;
        const bucket = (cached.keys[category] ??= {});
        for (const id in items) {
          const value = items[id];
          if (value === null || value === undefined) {
            if (bucket[id] !== undefined) {
              delete bucket[id];
              dirty = true;
            }
          } else {
            bucket[id] = value;
            dirty = true;
          }
        }
      }
      if (dirty) schedulePersist();
    },
    clear: async (): Promise<void> => {
      cached.keys = {};
      schedulePersist();
    },
  };

  const state: AuthenticationState = {
    creds: cached.creds,
    keys,
  };

  return {
    state,
    markDirty: () => schedulePersist(),
    flush: async () => {
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      await persistNow();
      if (inflight) await inflight;
    },
    clear: async () => {
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      const fresh: FullState = { creds: initAuthCreds(), keys: {} };
      cached = fresh;
      // Replace the live references the socket holds, so any in-flight
      // operations see the wiped state too.
      state.creds = fresh.creds;
      try {
        await crm.putAuthState(accountId, null);
      } catch (err) {
        log.error({ err, accountId }, "[crm-auth-state] clear failed");
      }
    },
  };
}

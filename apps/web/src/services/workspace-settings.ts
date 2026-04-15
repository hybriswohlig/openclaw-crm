/**
 * Per-workspace key/value store.
 *
 * Plain values (model IDs, limits, toggles) go into `value_plain`.
 * Secrets (API keys) go into `value_encrypted` via pgcrypto `pgp_sym_encrypt`,
 * using `SETTINGS_ENCRYPTION_KEY` as the symmetric key. The raw bytes never
 * leave Postgres — decryption happens in `pgp_sym_decrypt` too.
 */

import { db } from "@/db";
import { workspaceSettings } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";

function requireEncryptionKey(): string {
  const key = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!key || key.length < 16) {
    throw new Error(
      "SETTINGS_ENCRYPTION_KEY env var is missing or too short (min 16 chars)"
    );
  }
  return key;
}

export async function getSetting(
  workspaceId: string,
  key: string
): Promise<string | null> {
  const [row] = await db
    .select({ value: workspaceSettings.valuePlain, isSecret: workspaceSettings.isSecret })
    .from(workspaceSettings)
    .where(and(eq(workspaceSettings.workspaceId, workspaceId), eq(workspaceSettings.key, key)))
    .limit(1);

  if (!row || row.isSecret) return null;
  return row.value ?? null;
}

export async function setSetting(
  workspaceId: string,
  key: string,
  value: string
): Promise<void> {
  await db
    .insert(workspaceSettings)
    .values({
      workspaceId,
      key,
      valuePlain: value,
      isSecret: false,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [workspaceSettings.workspaceId, workspaceSettings.key],
      set: {
        valuePlain: value,
        valueEncrypted: null,
        isSecret: false,
        updatedAt: new Date(),
      },
    });
}

export async function getSecret(
  workspaceId: string,
  key: string
): Promise<string | null> {
  const encKey = requireEncryptionKey();
  const rows = await db.execute<{ value: string | null }>(sql`
    SELECT pgp_sym_decrypt(value_encrypted, ${encKey})::text AS value
    FROM workspace_settings
    WHERE workspace_id = ${workspaceId}
      AND key = ${key}
      AND is_secret = true
      AND value_encrypted IS NOT NULL
    LIMIT 1
  `);
  const first = rows[0];
  return first?.value ?? null;
}

export async function setSecret(
  workspaceId: string,
  key: string,
  value: string
): Promise<void> {
  const encKey = requireEncryptionKey();
  await db.execute(sql`
    INSERT INTO workspace_settings (workspace_id, key, value_plain, value_encrypted, is_secret, updated_at)
    VALUES (${workspaceId}, ${key}, NULL, pgp_sym_encrypt(${value}, ${encKey}), true, now())
    ON CONFLICT (workspace_id, key) DO UPDATE SET
      value_plain = NULL,
      value_encrypted = pgp_sym_encrypt(${value}, ${encKey}),
      is_secret = true,
      updated_at = now()
  `);
}

export async function deleteSetting(workspaceId: string, key: string): Promise<void> {
  await db
    .delete(workspaceSettings)
    .where(and(eq(workspaceSettings.workspaceId, workspaceId), eq(workspaceSettings.key, key)));
}

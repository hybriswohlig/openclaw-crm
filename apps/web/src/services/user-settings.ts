import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { normalizeUiVersion, type UiVersion } from "@/lib/ui-version";

export interface UserSettingsView {
  uiVersion: UiVersion;
  ansichten: Record<string, unknown>;
}

const DEFAULT_SETTINGS: UserSettingsView = { uiVersion: "alt", ansichten: {} };

function asAnsichten(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/** Standard ohne Zeile: alte Oberfläche, keine gespeicherten Ansichten. */
export async function getUserSettings(userId: string): Promise<UserSettingsView> {
  const [row] = await db
    .select({
      uiVersion: userSettings.uiVersion,
      ansichten: userSettings.ansichten,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);

  if (!row) return { ...DEFAULT_SETTINGS };

  return {
    uiVersion: normalizeUiVersion(row.uiVersion) ?? "alt",
    ansichten: asAnsichten(row.ansichten),
  };
}

/**
 * Legt die Zeile an oder merget einen Schlüssel in `ansichten`.
 * Andere Schlüssel und `ui_version` bleiben stehen.
 */
export async function setAnsicht(userId: string, schluessel: string, wert: unknown): Promise<void> {
  const jetzt = new Date();
  await db
    .insert(userSettings)
    .values({
      userId,
      ansichten: { [schluessel]: wert },
      updatedAt: jetzt,
    })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: {
        ansichten: sql`${userSettings.ansichten} || jsonb_build_object(${schluessel}::text, ${JSON.stringify(wert)}::jsonb)`,
        updatedAt: jetzt,
      },
    });
}

/** Legt die Zeile an oder überschreibt nur die Oberfläche. */
export async function setUiVersion(userId: string, v: UiVersion): Promise<void> {
  await db
    .insert(userSettings)
    .values({
      userId,
      uiVersion: v,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: {
        uiVersion: v,
        updatedAt: new Date(),
      },
    });
}

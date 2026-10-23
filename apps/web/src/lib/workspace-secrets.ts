/**
 * Geheime Felder in `workspaces.settings` (JSONB) vom Client fernhalten.
 *
 * GET /api/v1/workspace geht an jedes Mitglied (Seitenleiste, MCP-Tool
 * crm_whoami). In den Einstellungen liegt aber der OpenRouter-Schlüssel im
 * Klartext. Nach außen gehen die Einstellungen deshalb nur ohne geheime Felder,
 * dazu `hasOpenrouterKey` für alle, die wissen müssen, ob ein Schlüssel da ist.
 *
 * Geheim ist ein Feld, dessen Name auf apiKey, secret, token, password,
 * credentials oder privateKey endet, in jeder Tiefe. Heute betrifft das nur
 * `openrouterApiKey`; neue Felder dieser Art sind damit von selbst geschützt.
 */

const GEHEIMER_NAME =
  /(api[-_]?key|secret|token|passwor[dt]|credentials?|private[-_]?key)$/i;

export function isSecretSettingKey(key: string): boolean {
  return GEHEIMER_NAME.test(key);
}

function istObjekt(wert: unknown): wert is Record<string, unknown> {
  return typeof wert === "object" && wert !== null && !Array.isArray(wert);
}

function ohneGeheimnisse(wert: unknown): unknown {
  if (Array.isArray(wert)) return wert.map(ohneGeheimnisse);
  if (!istObjekt(wert)) return wert;
  const ergebnis: Record<string, unknown> = {};
  for (const [key, inhalt] of Object.entries(wert)) {
    if (isSecretSettingKey(key)) continue;
    ergebnis[key] = ohneGeheimnisse(inhalt);
  }
  return ergebnis;
}

/** Kopie der Einstellungen ohne geheime Felder. Leere oder kaputte Werte ergeben {}. */
export function stripSecretSettings(settings: unknown): Record<string, unknown> {
  return istObjekt(settings)
    ? (ohneGeheimnisse(settings) as Record<string, unknown>)
    : {};
}

/** Gleiche Regel wie hasApiKey in /api/v1/ai-settings. */
export function hasOpenrouterKey(settings: unknown): boolean {
  return istObjekt(settings) && Boolean(settings.openrouterApiKey);
}

/** Workspace-Zeile für die API: Einstellungen ohne Geheimnisse, plus hasOpenrouterKey. */
export function toPublicWorkspace<T extends { settings: unknown }>(
  workspace: T
): Omit<T, "settings"> & {
  settings: Record<string, unknown>;
  hasOpenrouterKey: boolean;
} {
  return {
    ...workspace,
    settings: stripSecretSettings(workspace.settings),
    hasOpenrouterKey: hasOpenrouterKey(workspace.settings),
  };
}

/**
 * Für PATCH: Der Client kennt die geheimen Felder nicht und schickt die
 * Einstellungen ohne sie zurück (allgemeine Einstellungen: `{ ...settings,
 * logo }`). Gespeicherte Geheimnisse, die im Eingang fehlen, bleiben deshalb
 * erhalten, auch in verschachtelten Objekten. Schickt der Client ein geheimes
 * Feld ausdrücklich mit, gilt sein Wert. In Listen wird nichts zurückgeholt.
 */
export function keepStoredSecrets(
  incoming: Record<string, unknown>,
  stored: unknown
): Record<string, unknown> {
  if (!istObjekt(stored)) return incoming;
  const ergebnis: Record<string, unknown> = { ...incoming };
  for (const [key, gespeichert] of Object.entries(stored)) {
    const eingang = incoming[key];
    if (isSecretSettingKey(key)) {
      if (!Object.prototype.hasOwnProperty.call(incoming, key)) {
        ergebnis[key] = gespeichert;
      }
    } else if (istObjekt(gespeichert) && istObjekt(eingang)) {
      ergebnis[key] = keepStoredSecrets(eingang, gespeichert);
    }
  }
  return ergebnis;
}

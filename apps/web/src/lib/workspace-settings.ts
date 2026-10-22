/**
 * `workspaces.settings` holds both UI settings and secrets (the OpenRouter
 * API key, set via /api/v1/ai-settings). The generic workspace route sends
 * settings to every member's browser and accepts the whole object back, so
 * secrets are stripped on the way out and carried over server-side on the
 * way in. Secrets only change through their own admin routes.
 */

const SECRET_KEY_RE = /(api[-_]?key|secret|token|password)$/i;

export function isSecretSettingKey(key: string): boolean {
  return SECRET_KEY_RE.test(key);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function redactWorkspaceSettings(settings: unknown): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(asRecord(settings)).filter(([key]) => !isSecretSettingKey(key))
  );
}

export function mergeWorkspaceSettingsUpdate(
  existing: unknown,
  incoming: unknown
): Record<string, unknown> {
  const storedSecrets = Object.fromEntries(
    Object.entries(asRecord(existing)).filter(([key]) => isSecretSettingKey(key))
  );
  return { ...redactWorkspaceSettings(incoming), ...storedSecrets };
}

/**
 * Anzeigename einer Person aus dem Wert des Attributs `name`: Text oder
 * personal_name-JSON. Im Bestand kommen beide Schreibweisen vor
 * (full_name/first_name/last_name und fullName/firstName/lastName).
 */
export function nameAusWert(textValue: string | null, jsonValue: unknown): string | null {
  const text = textValue?.trim();
  if (text) return text;
  if (!jsonValue || typeof jsonValue !== "object") return null;
  const n = jsonValue as Record<string, unknown>;
  const s = (k: string) => (typeof n[k] === "string" ? (n[k] as string).trim() : "");
  const voll = s("full_name") || s("fullName");
  if (voll) return voll;
  const teile = [s("first_name") || s("firstName"), s("last_name") || s("lastName")].filter(Boolean).join(" ");
  return teile || null;
}

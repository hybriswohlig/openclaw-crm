/**
 * Werte aus `db.execute` lesen (postgres-js über Drizzle). Rein, ohne
 * Datenbankzugriff; genutzt von den Ladern der Umzugsakte.
 */

/** Zeilen aus dem Ergebnis von `db.execute` (Array oder `{ rows }`). */
export function zeilen<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return (result as { rows?: T[] }).rows ?? [];
}

/**
 * `db.execute` liefert `timestamp`-Spalten als Text ohne Zeitzone (der
 * Postgres-Treiber parst sie nicht). Gespeichert ist UTC, wie Drizzle es liest.
 * Gleiche Regel wie in `services/nachfass-schalter.ts`.
 */
export function alsIso(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  const s = String(v).trim();
  const mitZone = /(?:[zZ]|[+-]\d{2}(?::?\d{2})?)$/.test(s);
  const d = new Date(mitZone ? s : `${s.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** jsonb aus `db.execute`: je nach Treiber schon geparst oder als Text. */
export function alsJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

export function alsZahl(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** `date`-Spalte („2026-11-21“, auch als Date um Mitternacht UTC) → „2026-11-21“, sonst null. */
export function alsTag(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})$/.exec(v.trim());
  return m ? m[1] : null;
}

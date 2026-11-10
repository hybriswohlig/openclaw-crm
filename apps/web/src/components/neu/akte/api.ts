/**
 * Kleiner Aufruf gegen `/api/v1` aus der Umzugsakte (Entscheidung 2): die Routen
 * antworten mit `{ data }` oder `{ error: { code, message } }`. Netzfehler und
 * Antworten ohne JSON werden zu einem Fehler mit deutscher Meldung.
 */

export type ApiAntwort<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string | null; message: string; fehler?: Record<string, unknown> };

interface Fehlerkoerper {
  data?: unknown;
  error?: string | { code?: unknown; message?: unknown };
}

export async function apiAufruf<T>(url: string, init?: RequestInit): Promise<ApiAntwort<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return { ok: false, status: 0, code: null, message: "Keine Verbindung zum Server." };
  }
  const body = (await res.json().catch(() => null)) as Fehlerkoerper | null;
  if (res.ok) return { ok: true, data: body?.data as T };
  // Einige ältere Routen (etwa das Senden) antworten mit `{ error: "Text" }`.
  const fehler = body?.error;
  const code = typeof fehler === "object" && fehler && typeof fehler.code === "string" ? fehler.code : null;
  const text =
    typeof fehler === "string" ? fehler : typeof fehler === "object" && fehler ? fehler.message : undefined;
  const message =
    typeof text === "string" && text.trim() !== "" ? text : `Der Server hat mit Fehler ${res.status} geantwortet.`;
  return { ok: false, status: res.status, code, message, ...(typeof fehler === "object" && fehler ? { fehler: fehler as Record<string, unknown> } : {}) };
}

/** `fetch`-Optionen für einen JSON-Körper; `kopf` für zusätzliche Header. */
export function jsonAufruf(method: "PUT" | "PATCH" | "POST", body: unknown, kopf?: Record<string, string>): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json", ...kopf },
    body: JSON.stringify(body),
  };
}

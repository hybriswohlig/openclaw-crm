"use client";

import { useEffect, useState } from "react";

/**
 * Kleiner Browser-Zwischenspeicher für die Sichtbarkeits-Reiter: Eine schon
 * geladene Ansicht erscheint beim Zurückwechseln sofort und wird im Hintergrund
 * aufgefrischt (stale-while-revalidate). Nur für Lesezugriffe.
 */
const cache = new Map<string, { data: unknown; at: number }>();
const inflight = new Map<string, Promise<unknown>>();
const FRESH_MS = 60_000;

async function load(url: string): Promise<unknown> {
  const running = inflight.get(url);
  if (running) return running;
  const p = fetch(url)
    .then(async (res) => {
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      cache.set(url, { data: json.data, at: Date.now() });
      return json.data;
    })
    .finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

/** Lädt eine URL im Hintergrund vor, z. B. die anderen Reiter. */
export function prefetchJson(url: string) {
  const hit = cache.get(url);
  if (!hit || Date.now() - hit.at > FRESH_MS) load(url).catch(() => {});
}

export function useCachedJson<T>(url: string | null): { data: T | null; loading: boolean; error: boolean } {
  const [state, setState] = useState<{ url: string | null; data: T | null; loading: boolean; error: boolean }>(() => {
    const hit = url ? cache.get(url) : undefined;
    return { url, data: (hit?.data as T) ?? null, loading: Boolean(url), error: false };
  });

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const hit = cache.get(url);
    // Sofort anzeigen, was schon da ist; nur neu laden, wenn es älter als eine Minute ist.
    // Ohne Treffer bleibt die vorige Ansicht abgeblendet stehen, bis die neue da ist.
    setState((s) => ({ url, data: hit ? (hit.data as T) : s.data, loading: !hit || Date.now() - hit.at > FRESH_MS, error: false }));
    if (hit && Date.now() - hit.at <= FRESH_MS) return;
    load(url)
      .then((data) => !cancelled && setState({ url, data: data as T, loading: false, error: false }))
      .catch(() => !cancelled && setState((s) => ({ ...s, loading: false, error: !s.data })));
    return () => {
      cancelled = true;
    };
  }, [url]);

  // Direkt nach einem URL-Wechsel (vor dem Effekt) gilt die Ansicht als "lädt".
  return { data: state.data, loading: state.loading || state.url !== url, error: state.error };
}

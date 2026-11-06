"use client";

import { useEffect, useState } from "react";
import type { NavZaehler } from "@/lib/plan-heute";

/** Zähler der Seitenleiste alle 60 s (Plan 8, Entscheidung 12). */
const TAKT_MS = 60_000;

/** Liest `{ data: NavZaehler }` aus `GET /api/v1/heute/zaehler`; alles andere ist null. */
export function navZaehlerLesen(roh: unknown): NavZaehler | null {
  if (typeof roh !== "object" || roh === null) return null;
  const data = (roh as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const { heute, leads } = data as { heute?: unknown; leads?: unknown };
  const zahl = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
  const h = zahl(heute);
  const l = zahl(leads);
  return h === null || l === null ? null : { heute: h, leads: l };
}

/**
 * Zähler „Heute“ (= Chip „warten auf uns“) und „Leads“ (offene Leads) für die
 * Seitenleiste. Fragt nur bei sichtbarem Tab: alle `intervalMs` und sofort,
 * wenn der Tab wieder sichtbar wird. Fehler bleiben still, der letzte Stand
 * bleibt stehen. `aktiv = false` (Seitenleiste ausgeblendet) fragt gar nicht.
 */
export function useNavZaehler(intervalMs: number = TAKT_MS, aktiv = true): NavZaehler | null {
  const [zaehler, setZaehler] = useState<NavZaehler | null>(null);

  useEffect(() => {
    if (!aktiv) return;
    let lebt = true;
    let laeuft = false;
    const laden = async () => {
      if (document.hidden || laeuft) return;
      laeuft = true;
      try {
        const res = await fetch("/api/v1/heute/zaehler");
        if (!res.ok) return;
        const neu = navZaehlerLesen(await res.json());
        if (lebt && neu) setZaehler(neu);
      } catch {
        // still: die Seitenleiste zeigt dann den letzten Stand
      } finally {
        laeuft = false;
      }
    };
    void laden();
    const id = window.setInterval(() => void laden(), intervalMs);
    const sichtbar = () => void laden();
    document.addEventListener("visibilitychange", sichtbar);
    return () => {
      lebt = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", sichtbar);
    };
  }, [intervalMs, aktiv]);

  return zaehler;
}

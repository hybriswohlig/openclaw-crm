"use client";

import "@/styles/neu-akte-handy.css";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { akteZurueckZiel, LEADS_LINK } from "./akte-zurueck-logik";

function ersteAdresse(): string | null {
  try {
    const [eintrag] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    return eintrag?.name || null;
  } catch {
    return null;
  }
}

/**
 * „‹ Leads“ oben in der Akte, nur unter 1024 px sichtbar (Plan 10, Entscheidung 9).
 * Mit Vorgänger aus der eigenen Oberfläche wie die Zurück-Taste, sonst zur Liste.
 * Die Seite trägt dazu `neu-akte-handy.css`: ein Dock statt zwei, Dock unten.
 */
export function AkteZurueck() {
  const router = useRouter();

  function beiKlick(e: MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const ziel = akteZurueckZiel({
      jetzt: window.location.href,
      ersteAdresse: ersteAdresse(),
      referrer: document.referrer,
      origin: window.location.origin,
      verlaufLaenge: window.history.length,
    });
    if (ziel.art !== "zurueck") return;
    e.preventDefault();
    router.back();
  }

  return (
    <nav className="akte-zurueck" aria-label="Zurück">
      <Link href={LEADS_LINK} onClick={beiKlick}>
        ‹ Leads
      </Link>
    </nav>
  );
}

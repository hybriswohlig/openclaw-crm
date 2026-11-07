"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ALT_PARAM } from "@/lib/dunkel-abschaltung";

const ZIEL = "/api/v1/alt-aufruf";

/**
 * Plan 14, Task W: meldet jede gerenderte alte Seite einmal je Pfadwechsel
 * (Grundlage der Lösch-Checkliste). Zeigt nichts; Fehler bleiben still.
 */
export function AltAufrufBeacon(): null {
  const pfad = usePathname();
  const mitAlt = useSearchParams()?.has(ALT_PARAM) ?? false;

  useEffect(() => {
    if (!pfad) return;
    const daten = JSON.stringify({ pfad, mitAlt });
    try {
      if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon(ZIEL, new Blob([daten], { type: "application/json" }))) {
        return;
      }
    } catch {
      // weiter mit fetch
    }
    fetch(ZIEL, {
      method: "POST",
      body: daten,
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
    }).catch(() => {});
  }, [pfad, mitAlt]);

  return null;
}

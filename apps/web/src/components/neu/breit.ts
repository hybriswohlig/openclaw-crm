"use client";

import { useEffect, useState } from "react";

/** Umbruch der Shell: ab hier Seitenleiste statt Handy-Dock (neu.css). */
export const BREIT_AB = "(min-width: 1024px)";

/**
 * Ob das Fenster die Abfrage erfüllt; `null` vor dem Einhängen (Server und
 * erste Hydration kennen die Breite nicht). Für Seiten, die am Handy anders
 * aufgebaut sind als am Desktop, nicht nur anders gestylt (Inbox, Plan 6).
 */
export function useBreit(abfrage: string = BREIT_AB): boolean | null {
  const [breit, setBreit] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia(abfrage);
    const lesen = () => setBreit(mq.matches);
    lesen();
    mq.addEventListener("change", lesen);
    return () => mq.removeEventListener("change", lesen);
  }, [abfrage]);
  return breit;
}

"use client";

import { useEffect, useState } from "react";

/**
 * Das `[data-neu]`-Element als Ziel für Radix-Portale (Menüs, Dialoge). Ohne
 * dieses Ziel landen sie in `<body>`, außerhalb der Farben und Regeln der
 * neuen Oberfläche. Vor der Hydration `undefined`, dann nimmt Radix `<body>`;
 * geöffnet wird ohnehin erst nach einer Eingabe.
 */
export function usePortalZiel(): HTMLElement | undefined {
  const [ziel, setZiel] = useState<HTMLElement | undefined>(undefined);
  useEffect(() => {
    setZiel(document.querySelector<HTMLElement>("[data-neu]") ?? undefined);
  }, []);
  return ziel;
}

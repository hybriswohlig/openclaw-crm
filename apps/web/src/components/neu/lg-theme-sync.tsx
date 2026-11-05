"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { haltLgThemeFest, lgThemeFor } from "@/lib/lg-theme";

/**
 * Schreibt das Glassy-Theme auf <html>. Ohne `erzwingen` folgt es next-themes;
 * mit `erzwingen` bleibt es fest, egal was next-themes meldet oder was
 * GlassProvider nach der Hydration aus gespeicherten Vorlieben setzt
 * (ein MutationObserver setzt data-lg-theme zurück, siehe haltLgThemeFest).
 */
export function LgThemeSync({ erzwingen }: { erzwingen?: "light" | "dark" } = {}) {
  const { resolvedTheme } = useTheme();
  const theme = erzwingen ?? lgThemeFor(resolvedTheme);

  useEffect(() => {
    if (erzwingen) return haltLgThemeFest(document.documentElement, erzwingen);
    document.documentElement.dataset.lgTheme = theme;
  }, [erzwingen, theme]);

  return null;
}

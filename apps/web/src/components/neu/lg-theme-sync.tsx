"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { lgThemeFor } from "@/lib/lg-theme";

/**
 * Schreibt das Glassy-Theme auf <html>. Ohne `erzwingen` folgt es next-themes;
 * mit `erzwingen` bleibt es fest, egal was next-themes meldet.
 */
export function LgThemeSync({ erzwingen }: { erzwingen?: "light" | "dark" } = {}) {
  const { resolvedTheme } = useTheme();
  const theme = erzwingen ?? lgThemeFor(resolvedTheme);

  useEffect(() => {
    document.documentElement.dataset.lgTheme = theme;
  }, [theme]);

  return null;
}

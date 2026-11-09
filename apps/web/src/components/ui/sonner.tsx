"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";
import { toasterTheme } from "@/components/neu/darstellung-logik";

/** Liest `data-lg-theme` von <html> und hört auf Änderungen (nur lesen, setzt nichts). */
function abonnierenLgTheme(melden: () => void): () => void {
  const beobachter = new MutationObserver(melden);
  beobachter.observe(document.documentElement, { attributes: true, attributeFilter: ["data-lg-theme"] });
  return () => beobachter.disconnect();
}

/**
 * Theme der Toasts (Plan 14b, Entscheidung 10): unter /app folgt es der neuen Oberfläche
 * (`data-lg-theme`), sonst wie bisher next-themes.
 */
export function useToasterTheme(): "light" | "dark" {
  const pfad = usePathname();
  const { resolvedTheme } = useTheme();
  const lgTheme = useSyncExternalStore(
    abonnierenLgTheme,
    () => document.documentElement.getAttribute("data-lg-theme"),
    () => null
  );
  return toasterTheme(pfad, lgTheme, resolvedTheme);
}

export function Toaster(props: React.ComponentProps<typeof Sonner>) {
  const theme = useToasterTheme();

  return (
    <Sonner
      theme={theme}
      position="top-right"
      richColors
      closeButton
      {...props}
    />
  );
}

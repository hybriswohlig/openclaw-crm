"use client";

import "@/components/glassyui/styles/liquid.css";
import "@/styles/neu.css";

import { useEffect } from "react";
import { ApprovalGate } from "@/components/layout/approval-gate";
import { BackgroundJobsProvider } from "@/components/background-jobs";
import { GlassProvider } from "@/components/glassyui/glass-provider";
import { HandyDock } from "@/components/neu/handy-dock";
import { Hintergrund } from "@/components/neu/hintergrund";
import { LgThemeSync } from "@/components/neu/lg-theme-sync";
import { Seitenleiste } from "@/components/neu/seitenleiste";

/** Alles, was GlassProvider und LgThemeSync auf <html> schreiben. */
const GLAS_ATTRIBUTE = [
  "data-lg-theme",
  "data-lg-mode",
  "data-lg-reduce-transparency",
  "data-lg-reduce-motion",
  "data-lg-quality",
] as const;

/**
 * Hülle der neuen Oberfläche unter /app/*. Die alten Seiten bleiben unter ihren Pfaden.
 *
 * Theme: Meilenstein 1 hat keinen Dark Mode (Spec, Nicht-Ziele). Die Shell ist fest hell,
 * auch wenn next-themes „dark“ meldet. GlassProvider schreibt data-lg-theme selbst und würde
 * ohne Vorgabe dunkel starten; er bekommt deshalb "light" als Vorgabe. Gespeicherte Vorlieben
 * (glassy-ui-preferences) setzt er nach der Hydration trotzdem; LgThemeSync mit `erzwingen`
 * beobachtet data-lg-theme deshalb und setzt jedes andere Theme sofort auf "light" zurück.
 */
export default function NeuLayout({ children }: { children: React.ReactNode }) {
  // Beim Verlassen von /app (z. B. Umschalter zu /home) die Glas-Attribute wieder entfernen,
  // sonst greifen etwa die Reduce-Motion-Regeln von liquid.css auch auf alten Seiten.
  useEffect(() => {
    return () => {
      const root = document.documentElement;
      for (const name of GLAS_ATTRIBUTE) root.removeAttribute(name);
      root.style.removeProperty("--lg-glass-thickness");
    };
  }, []);

  return (
    <ApprovalGate>
      <BackgroundJobsProvider>
        <GlassProvider defaultTheme="light">
          <div data-neu="">
            <Hintergrund />
            <div className="neu-geruest">
              <Seitenleiste />
              <main className="neu-inhalt">{children}</main>
            </div>
            <HandyDock />
          </div>
        </GlassProvider>
        <LgThemeSync erzwingen="light" />
      </BackgroundJobsProvider>
    </ApprovalGate>
  );
}

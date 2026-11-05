"use client";

import "@/components/glassyui/styles/liquid.css";
import "@/styles/neu.css";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { ApprovalGate } from "@/components/layout/approval-gate";
import { BackgroundJobsProvider } from "@/components/background-jobs";
import { GlassProvider } from "@/components/glassyui/glass-provider";
import { HandyDock } from "@/components/neu/handy-dock";
import { Hintergrund } from "@/components/neu/hintergrund";
import { LgThemeSync } from "@/components/neu/lg-theme-sync";
import { Seitenleiste } from "@/components/neu/seitenleiste";
import { lgThemeFor } from "@/lib/lg-theme";

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
 * Theme: GlassProvider schreibt data-lg-theme selbst und würde ohne Vorgabe dunkel starten.
 * Er bekommt deshalb das Theme aus next-themes als Vorgabe, und LgThemeSync steht als
 * Geschwister hinter ihm, damit sein Effekt zuletzt läuft und dasselbe Theme festhält.
 */
export default function NeuLayout({ children }: { children: React.ReactNode }) {
  const { resolvedTheme } = useTheme();

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
        <GlassProvider defaultTheme={lgThemeFor(resolvedTheme)}>
          <div data-neu="">
            <Hintergrund />
            <div className="neu-geruest">
              <Seitenleiste />
              <main className="neu-inhalt">{children}</main>
            </div>
            <HandyDock />
          </div>
        </GlassProvider>
        <LgThemeSync />
      </BackgroundJobsProvider>
    </ApprovalGate>
  );
}

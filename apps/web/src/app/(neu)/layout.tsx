"use client";

import "@/components/glassyui/styles/liquid.css";
import "@/styles/neu.css";
import "@/styles/neu-akte.css";

import { useEffect } from "react";
import { ApprovalGate } from "@/components/layout/approval-gate";
import { BackgroundJobsProvider } from "@/components/background-jobs";
import { GlassProvider } from "@/components/glassyui/glass-provider";
import { DarstellungSync, useDarstellung } from "@/components/neu/darstellung";
import { HandyDock } from "@/components/neu/handy-dock";
import { Hintergrund } from "@/components/neu/hintergrund";
import { Seitenleiste } from "@/components/neu/seitenleiste";
import { ShellBanner } from "@/components/neu/shell-banner";

/** Alles, was GlassProvider und DarstellungSync auf <html> schreiben. */
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
 * Theme (Plan 14b): Quelle ist die Darstellung des Nutzers (hell, dunkel, wie das Gerät).
 * Das Kopf-Skript im Root-Layout setzt data-lg-theme vor dem ersten Bild aus dem Cookie
 * `neu_darstellung`; danach steuert `useDarstellung` den GlassProvider. Gespeicherte
 * Glassy-Vorlieben können das Theme nicht mehr kippen (`theme` schlägt sie). Die Klasse
 * `dark` von next-themes spielt unter /app keine Rolle.
 */
export default function NeuLayout({ children }: { children: React.ReactNode }) {
  const { theme } = useDarstellung();

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
        <GlassProvider defaultTheme="light" theme={theme}>
          <div data-neu="">
            <Hintergrund />
            <div className="neu-geruest">
              <Seitenleiste />
              <main className="neu-inhalt">
                <ShellBanner />
                {children}
              </main>
            </div>
            <HandyDock />
          </div>
        </GlassProvider>
        <DarstellungSync theme={theme} />
      </BackgroundJobsProvider>
    </ApprovalGate>
  );
}

"use client";

import "@/styles/neu-heute-karte.css";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BrettSilhouette } from "@/components/lagekarte/ladebild";
import { useDarstellung } from "@/components/neu/darstellung";
import type { LgTheme } from "@/lib/dunkel-abschaltung";

/** Thema der Lagekarte aus der Darstellung der neuen Oberfläche (Plan 14b), nie aus next-themes. */
export function lagekarteThema(theme: LgTheme): "hell" | "dunkel" {
  return theme === "dark" ? "dunkel" : "hell";
}

/** Ladebild im Thema der neuen Oberfläche, solange die Karte lädt. */
function LadebildNeu() {
  const { theme } = useDarstellung();
  return (
    <div
      className={`lagekarte ${theme === "dark" ? "lagekarte--dunkel" : ""} relative flex h-full w-full items-center justify-center overflow-hidden`}
    >
      <BrettSilhouette />
    </div>
  );
}

const Lagekarte = dynamic(() => import("@/components/lagekarte/lagekarte"), {
  ssr: false,
  loading: () => <LadebildNeu />,
});

/**
 * Lagekarte als Ansicht unter Heute (Plan 10, Entscheidung 12). Füllt die Höhe
 * des Inhalts; am Handy endet sie über dem Handy-Dock. „Liste“ im HUD führt
 * zurück nach Heute, weil die klassische Startseite zur alten Oberfläche gehört.
 */
export function LagekarteAnsicht() {
  const router = useRouter();
  const { theme } = useDarstellung();
  return (
    <div className="heute-karte">
      <nav className="heute-karte-kopf" aria-label="Zurück">
        <Link href="/app/heute">‹ Heute</Link>
        <h1 className="heute-karte-titel">Lagekarte</h1>
      </nav>
      <div className="heute-karte-flaeche">
        <Lagekarte thema={lagekarteThema(theme)} onListe={() => router.push("/app/heute")} />
      </div>
    </div>
  );
}

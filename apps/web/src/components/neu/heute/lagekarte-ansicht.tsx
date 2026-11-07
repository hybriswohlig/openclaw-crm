"use client";

import "@/styles/neu-heute-karte.css";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BrettSilhouette } from "@/components/lagekarte/ladebild";

/** Ladebild fest hell, wie die Karte in der neuen Oberfläche (Dark Mode erst in Plan 14). */
function LadebildHell() {
  return (
    <div className="lagekarte relative flex h-full w-full items-center justify-center overflow-hidden">
      <BrettSilhouette />
    </div>
  );
}

const Lagekarte = dynamic(() => import("@/components/lagekarte/lagekarte"), {
  ssr: false,
  loading: () => <LadebildHell />,
});

/**
 * Lagekarte als Ansicht unter Heute (Plan 10, Entscheidung 12). Füllt die Höhe
 * des Inhalts; am Handy endet sie über dem Handy-Dock. „Liste“ im HUD führt
 * zurück nach Heute, weil die klassische Startseite zur alten Oberfläche gehört.
 */
export function LagekarteAnsicht() {
  const router = useRouter();
  return (
    <div className="heute-karte">
      <nav className="heute-karte-kopf" aria-label="Zurück">
        <Link href="/app/heute">‹ Heute</Link>
        <h1 className="heute-karte-titel">Lagekarte</h1>
      </nav>
      <div className="heute-karte-flaeche">
        <Lagekarte thema="hell" onListe={() => router.push("/app/heute")} />
      </div>
    </div>
  );
}

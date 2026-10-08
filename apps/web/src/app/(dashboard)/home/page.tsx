"use client";

/**
 * Startseite: Lagekarte oder klassische Startseite, pro Gerät gemerkt in
 * localStorage["kottke:start-ansicht"]. Leerer Speicher zeigt die Karte.
 * Die Karte lädt client-only nach (MapLibre braucht window und WebGL2).
 */
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { MapPinned } from "lucide-react";
import KlassischeStartseite from "@/components/home/klassische-startseite";
import Ladebild from "@/components/lagekarte/ladebild";

const Lagekarte = dynamic(() => import("@/components/lagekarte/lagekarte"), {
  ssr: false,
  loading: () => <Ladebild />,
});

type StartAnsicht = "karte" | "liste";

const SCHLUESSEL = "kottke:start-ansicht";

function leseStartAnsicht(): StartAnsicht {
  try {
    return window.localStorage.getItem(SCHLUESSEL) === "liste" ? "liste" : "karte";
  } catch {
    return "karte";
  }
}

export default function HomePage() {
  // Erst nach dem Mount aus localStorage lesen: Server und erster Client-Render
  // stimmen so überein, und wer die Liste gewählt hat, lädt den Kartenteil nicht.
  const [ansicht, setAnsicht] = useState<StartAnsicht | null>(null);

  useEffect(() => {
    setAnsicht(leseStartAnsicht());
  }, []);

  const wechsle = useCallback((naechste: StartAnsicht) => {
    setAnsicht(naechste);
    try {
      window.localStorage.setItem(SCHLUESSEL, naechste);
    } catch {
      /* privater Modus: gilt nur für diese Sitzung */
    }
  }, []);

  if (ansicht === null) return <div className="h-full" aria-busy="true" />;

  if (ansicht === "karte") return <Lagekarte onListe={() => wechsle("liste")} />;

  return (
    // h-full statt min-h-full: die Startseite rechnet mit min-h-full gegen eine feste Höhe.
    <div className="relative h-full">
      <KlassischeStartseite />
      <button
        type="button"
        onClick={() => wechsle("karte")}
        // Schmal schwebt der Knopf über der Tab-Leiste (oben läge er auf Datum und Begrüßung),
        // ab sm oben rechts neben der Begrüßung.
        className="lk-zur-karte fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+96px)] z-30 inline-flex h-11 items-center gap-2 rounded-full border px-4 text-[13px] font-medium transition-transform hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 sm:absolute sm:top-5 sm:right-6 sm:bottom-auto sm:z-20 sm:h-10"
        style={{
          background: "var(--ink)",
          color: "var(--paper)",
          borderColor: "transparent",
          outlineColor: "var(--kottke-accent)",
        }}
      >
        <MapPinned className="size-4" aria-hidden="true" />
        Zur Lagekarte
      </button>
    </div>
  );
}

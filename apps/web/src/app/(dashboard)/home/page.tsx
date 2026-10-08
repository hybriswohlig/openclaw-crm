"use client";

/**
 * Startseite: Lagekarte oder klassische Startseite, pro Gerät gemerkt in
 * localStorage["kottke:start-ansicht"]. Leerer Speicher zeigt die Karte.
 * Die Karte lädt client-only nach (MapLibre braucht window und WebGL2).
 *
 * Kein leerer erster Frame: Die Ansicht kommt per useSyncExternalStore aus
 * localStorage. Server und Hydrierung sehen „offen“ und zeigen das Ladebild
 * (dasselbe wie beim Nachladen der Karte); gleich danach, noch vor dem
 * Zeichnen, gilt der gemerkte Wert. Bei einer Navigation innerhalb der App
 * steht die richtige Ansicht schon im ersten Rendern. Wer die Liste gewählt
 * hat, lädt den Kartenteil nie.
 */
import { useCallback, useSyncExternalStore } from "react";
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

/* Kleiner Speicher um localStorage: Wechsel benachrichtigt die Seite; ohne Speicher
   (privater Modus) gilt die Wahl im Arbeitsspeicher bis zum Neuladen. */
const zuhoerer = new Set<() => void>();
let ohneSpeicher: StartAnsicht | null = null;

function leseStartAnsicht(): StartAnsicht {
  if (ohneSpeicher) return ohneSpeicher;
  try {
    return window.localStorage.getItem(SCHLUESSEL) === "liste" ? "liste" : "karte";
  } catch {
    return "karte";
  }
}

function abonnieren(melden: () => void): () => void {
  zuhoerer.add(melden);
  const beiSpeicher = (e: StorageEvent) => {
    if (e.key === SCHLUESSEL) melden();
  };
  window.addEventListener("storage", beiSpeicher);
  return () => {
    zuhoerer.delete(melden);
    window.removeEventListener("storage", beiSpeicher);
  };
}

function speichereStartAnsicht(ansicht: StartAnsicht) {
  try {
    window.localStorage.setItem(SCHLUESSEL, ansicht);
    ohneSpeicher = null;
  } catch {
    ohneSpeicher = ansicht;
  }
  for (const melden of zuhoerer) melden();
}

export default function HomePage() {
  const ansicht = useSyncExternalStore<StartAnsicht | null>(abonnieren, leseStartAnsicht, () => null);

  const wechsle = useCallback((naechste: StartAnsicht) => speichereStartAnsicht(naechste), []);

  if (ansicht === null) return <Ladebild />;

  if (ansicht === "karte") return <Lagekarte onListe={() => wechsle("liste")} />;

  return (
    // h-full statt min-h-full: die Startseite rechnet mit min-h-full gegen eine feste Höhe.
    <div className="relative h-full">
      <KlassischeStartseite />
      <button
        type="button"
        onClick={() => wechsle("karte")}
        // Immer fixed, damit der Weg zurück zur Karte beim Scrollen sichtbar bleibt:
        // schmal über der Tab-Leiste, ab md (ohne Tab-Leiste) unten rechts.
        className="lk-zur-karte fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+96px)] z-30 inline-flex h-11 items-center gap-2 rounded-full border px-4 text-[13px] font-medium transition-transform hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 md:right-6 md:bottom-6 md:h-10"
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

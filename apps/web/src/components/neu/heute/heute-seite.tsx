"use client";

import "@/styles/neu-heute.css";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import { apiAufruf } from "@/components/neu/akte/api";
import { useBreit } from "@/components/neu/breit";
import { berlinDateString } from "@/lib/berlin-date";
import { heuteKopf, type HeuteAntwort } from "@/lib/plan-heute";
import { HeuteInboxChips, HeuteLeadsChips } from "./heute-chips";
import { HeuteKopf } from "./heute-kopf";
import { HeuteListen } from "./heute-listen";
import { LADE_FEHLER_TEXT, handyUnterzeile, ladeFehlerFolge, type HeuteLadeGrund } from "./heute-logik";
import { HeuteTermine } from "./heute-termine";
import { Tagesabschluss } from "./tagesabschluss";

/** Heute alle 60 s still neu (Entscheidung 19), nur bei sichtbarem Tab. */
const TAKT_MS = 60_000;

type Zustand = { art: "laden" } | { art: "fehler"; meldung: string } | { art: "fertig"; antwort: HeuteAntwort };

/** Mittag des Berliner Tags: `heuteKopf` liest daraus sicher denselben Tag. */
function mittagVon(tag: string): Date {
  return new Date(`${tag}T12:00:00Z`);
}

/**
 * /app/heute (Plan 8, Entscheidung 11): die Startseite der neuen Oberfläche.
 * Lädt `GET /api/v1/heute` beim Öffnen und alle 60 s (nur sichtbarer Tab,
 * beim Zurückkehren sofort, Lauf-Zähler gegen veraltete Antworten). Zeigt
 * Kopf, Leads-Chips, Inbox „Jetzt“, die Panels Heute und Morgen sowie
 * Zahlungsmeldungen und Freigaben. Nur lesend: Aktionen laufen über die
 * verlinkten Seiten.
 */
export function HeuteSeite() {
  const breit = useBreit();
  const [zustand, setZustand] = useState<Zustand>({ art: "laden" });
  const lauf = useRef(0);
  const hatDaten = useRef(false);
  hatDaten.current = zustand.art === "fertig";

  const laden = useCallback(async (grund: HeuteLadeGrund) => {
    const dieser = ++lauf.current;
    if (grund === "erneut") setZustand({ art: "laden" });
    const r = await apiAufruf<HeuteAntwort>("/api/v1/heute");
    if (dieser !== lauf.current) return;
    if (r.ok) {
      setZustand({ art: "fertig", antwort: r.data });
      return;
    }
    const folge = ladeFehlerFolge(hatDaten.current, grund);
    if (folge === "fehler") setZustand({ art: "fehler", meldung: r.message });
    if (folge === "toast") toast.error(LADE_FEHLER_TEXT, { description: r.message });
  }, []);

  useEffect(() => {
    void laden("oeffnen");
  }, [laden]);

  // Takt: nur bei sichtbarem Tab; beim Zurückkehren sofort.
  useEffect(() => {
    const takt = () => {
      if (document.hidden) return;
      void laden("takt");
    };
    const id = window.setInterval(takt, TAKT_MS);
    document.addEventListener("visibilitychange", takt);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", takt);
    };
  }, [laden]);

  if (breit === null) return <HeuteSkelett kompakt={false} />;

  const a = zustand.art === "fertig" ? zustand.antwort : null;
  const tag = a?.tag ?? berlinDateString();
  const kopf = heuteKopf(mittagVon(tag));
  const kompakt = !breit;

  const kopfZeile = <HeuteKopf tag={tag} kopf={kopf} unterzeile={handyUnterzeile(kopf, a ? a.heute.length : null)} kompakt={kompakt} />;

  if (zustand.art === "laden") return <HeuteSkelett kompakt={kompakt} kopfZeile={kopfZeile} />;

  if (zustand.art === "fehler") {
    return (
      <div className="heute">
        {kopfZeile}
        <div className="heute-hinweis" role="alert">
          <p>
            {LADE_FEHLER_TEXT} {zustand.meldung}
          </p>
          <GlassButton size="sm" onClick={() => void laden("erneut")}>
            Erneut versuchen
          </GlassButton>
        </div>
      </div>
    );
  }

  const antwort = zustand.antwort;
  return (
    <div className="heute" data-kompakt={kompakt || undefined}>
      {kopfZeile}
      <HeuteLeadsChips chips={antwort.chips} kompakt={kompakt} />
      <HeuteInboxChips chips={antwort.inbox} abgeschnitten={antwort.inboxAbgeschnitten} kompakt={kompakt} />
      <Tagesabschluss
        karten={antwort.tagesabschluss ?? []}
        durchgefuehrtStufe={antwort.durchgefuehrtStufe ?? null}
        onNeuLaden={() => laden("takt")}
      />
      <div className="heute-koerper">
        <div className="heute-spalte heute-spalte-termine">
          <HeuteTermine antwort={antwort} />
        </div>
        <div className="heute-spalte heute-spalte-listen">
          <HeuteListen antwort={antwort} />
        </div>
      </div>
    </div>
  );
}

function HeuteSkelett({ kompakt, kopfZeile }: { kompakt: boolean; kopfZeile?: React.ReactNode }) {
  return (
    <div className="heute" aria-busy="true" aria-label="Heute wird geladen" data-kompakt={kompakt || undefined}>
      {kopfZeile ?? (
        <header className="neu-kopf heute-kopf">
          <div className="heute-kopf-text">
            <h1>Heute</h1>
          </div>
        </header>
      )}
      <span className="lg-skeleton heute-skelett-chips" />
      <span className="lg-skeleton heute-skelett-chips" />
      <div className="heute-koerper">
        <div className="heute-spalte">
          <span className="lg-skeleton heute-skelett-panel" />
          <span className="lg-skeleton heute-skelett-panel heute-skelett-klein" />
        </div>
        <div className="heute-spalte">
          <span className="lg-skeleton heute-skelett-panel heute-skelett-klein" />
          <span className="lg-skeleton heute-skelett-panel heute-skelett-klein" />
        </div>
      </div>
    </div>
  );
}

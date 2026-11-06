"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import type { AkteDaten } from "@/lib/akte";
import type { Gespraech } from "@/services/gespraech";
import { AkteKopf } from "./akte-kopf";
import { apiAufruf } from "./api";
import { Zahlenreihe } from "./zahlenreihe";

export type GespraechDaten = Gespraech;

type Zustand =
  | { art: "laden" }
  | { art: "nicht_gefunden" }
  | { art: "fehler"; meldung: string }
  | { art: "fertig"; akte: AkteDaten; gespraech: GespraechDaten };

/**
 * Die Umzugsakte: lädt `/akte` und `/gespraech` (Entscheidung 2), hält beide
 * im Zustand und gibt `neuLaden()` an die Kinder. Raster: Kopf, Zahlenreihe,
 * dann Gespräch links und Ablauf rechts (Spec 3.2).
 */
export function AkteSeite({ dealId }: { dealId: string }) {
  const [zustand, setZustand] = useState<Zustand>({ art: "laden" });
  const lauf = useRef(0);

  const neuLaden = useCallback(async () => {
    const dieser = ++lauf.current;
    const [a, g] = await Promise.all([
      apiAufruf<AkteDaten>(`/api/v1/deals/${dealId}/akte`),
      apiAufruf<GespraechDaten>(`/api/v1/deals/${dealId}/gespraech`),
    ]);
    if (dieser !== lauf.current) return;
    if (a.ok && g.ok) {
      setZustand({ art: "fertig", akte: a.data, gespraech: g.data });
      return;
    }
    const f = !a.ok ? a : !g.ok ? g : null;
    if (!f) return;
    setZustand(f.status === 404 ? { art: "nicht_gefunden" } : { art: "fehler", meldung: f.message });
  }, [dealId]);

  useEffect(() => {
    void neuLaden();
    return () => {
      lauf.current++;
    };
  }, [neuLaden]);

  if (zustand.art === "laden") return <AkteSkelett />;

  if (zustand.art === "nicht_gefunden") {
    return (
      <Hinweis titel="Akte nicht gefunden" text="Diesen Deal gibt es nicht oder nicht in diesem Workspace.">
        <GlassButton asChild>
          <Link href="/app/leads">Zu den Leads</Link>
        </GlassButton>
      </Hinweis>
    );
  }

  if (zustand.art === "fehler") {
    return (
      <Hinweis titel="Akte konnte nicht geladen werden" text={zustand.meldung}>
        <GlassButton onClick={() => void neuLaden()}>Erneut laden</GlassButton>
      </Hinweis>
    );
  }

  const { akte } = zustand;

  return (
    <div className="akte">
      <AkteKopf
        dealId={dealId}
        kopf={akte.kopf}
        nachfass={akte.nachfass}
        altLink={akte.altLink}
        onNachfass={(nachfass) =>
          setZustand((z) => (z.art === "fertig" ? { ...z, akte: { ...z.akte, nachfass } } : z))
        }
        onNeuLaden={neuLaden}
      />
      <Zahlenreihe kacheln={akte.kacheln} />
      <div className="akte-koerper">
        {/* Task 13 setzt hier das Gespräch-Panel ein (zustand.gespraech, neuLaden). */}
        <section className="akte-gespraech" data-slot="gespraech" aria-label="Gespräch">
          <SlotPanel titel="Gespräch" unter="Alle Kanäle in einem Verlauf." />
        </section>
        {/* Task 12 setzt hier das Ablauf-Panel ein (akte.ablauf, akte.dock, neuLaden). */}
        <aside className="akte-ablauf" data-slot="ablauf" aria-label="Ablauf">
          <SlotPanel
            titel="Ablauf"
            unter="Von der Anfrage bis zur Bewertung."
            rechts={`${akte.ablauf.position} von ${akte.ablauf.schritte.length}`}
          />
        </aside>
      </div>
    </div>
  );
}

/** Panel-Hülle mit Kopfzeile, bis Task 12 und 13 ihre Inhalte einsetzen. */
function SlotPanel({ titel, unter, rechts }: { titel: string; unter: string; rechts?: string }) {
  return (
    <GlassPanel variant="panel" className="akte-panel">
      <div className="akte-panel-kopf">
        <div>
          <h2 className="akte-panel-titel">{titel}</h2>
          <p className="akte-panel-unter">{unter}</p>
        </div>
        {rechts ? <span className="akte-panel-rechts">{rechts}</span> : null}
      </div>
      <div className="akte-panel-leer" />
    </GlassPanel>
  );
}

function Hinweis({ titel, text, children }: { titel: string; text: string; children: React.ReactNode }) {
  return (
    <GlassPanel variant="panel" className="akte-hinweis" role="alert">
      <h1>{titel}</h1>
      <p>{text}</p>
      <div className="akte-hinweis-aktion">{children}</div>
    </GlassPanel>
  );
}

function AkteSkelett() {
  return (
    <div className="akte-skelett" aria-busy="true" aria-label="Akte wird geladen">
      <div className="akte-skelett-kopf">
        <span className="lg-skeleton akte-skelett-name" />
        <span className="lg-skeleton akte-skelett-zweite" />
        <span className="lg-skeleton akte-skelett-meta" />
      </div>
      <div className="akte-zahlen">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="lg-skeleton akte-skelett-kachel" />
        ))}
      </div>
      <div className="akte-koerper">
        <span className="lg-skeleton akte-skelett-panel" />
        <span className="lg-skeleton akte-skelett-panel" />
      </div>
    </div>
  );
}

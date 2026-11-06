"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import type { AkteDaten } from "@/lib/akte";
import type { Gespraech } from "@/services/gespraech";
import { AblaufPanel } from "./ablauf-panel";
import { AkteKopf } from "./akte-kopf";
import { apiAufruf } from "./api";
import { GespraechPanel } from "./gespraech-panel";
import { Zahlenreihe } from "./zahlenreihe";

/** Task 14 hängt hier die Dialoge „Zahlung erfassen“ und „Bewertung anfragen“ ein. */
const nochKeinDialog = () => undefined;

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
 *
 * Ein neuer `dealId` zeigt wieder das Skelett. Schlägt ein Neuladen nach einer
 * Aktion fehl, bleibt die Seite stehen und ein Toast erscheint; die Fehler- und
 * 404-Ansicht gibt es nur, solange noch keine Akte da ist.
 */
export function AkteSeite({ dealId }: { dealId: string }) {
  const [zustand, setZustand] = useState<Zustand>({ art: "laden" });
  const lauf = useRef(0);
  const hatAkte = useRef(false);
  hatAkte.current = zustand.art === "fertig";

  const laden = useCallback(
    async (deal: string) => {
      const dieser = ++lauf.current;
      const stillOhneSeite = !hatAkte.current;
      const [a, g] = await Promise.all([
        apiAufruf<AkteDaten>(`/api/v1/deals/${deal}/akte`),
        apiAufruf<GespraechDaten>(`/api/v1/deals/${deal}/gespraech`),
      ]);
      if (dieser !== lauf.current) return;
      if (a.ok && g.ok) {
        setZustand({ art: "fertig", akte: a.data, gespraech: g.data });
        return;
      }
      const f = !a.ok ? a : !g.ok ? g : null;
      if (!f) return;
      if (!stillOhneSeite) {
        toast.error("Akte konnte nicht neu geladen werden.", { description: f.message });
        return;
      }
      setZustand(f.status === 404 ? { art: "nicht_gefunden" } : { art: "fehler", meldung: f.message });
    },
    []
  );

  useEffect(() => {
    hatAkte.current = false;
    setZustand({ art: "laden" });
    void laden(dealId);
    return () => {
      lauf.current++;
    };
  }, [dealId, laden]);

  const neuLaden = useCallback(() => laden(dealId), [laden, dealId]);

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
        <section className="akte-gespraech" data-slot="gespraech" aria-label="Gespräch">
          <GespraechPanel dealId={dealId} gespraech={zustand.gespraech} kundeName={akte.kopf.name} onNeuLaden={neuLaden} />
        </section>
        <aside className="akte-ablauf" data-slot="ablauf" aria-label="Ablauf">
          <AblaufPanel
            dealId={dealId}
            ablauf={akte.ablauf}
            zahlung={akte.zahlung}
            altLink={akte.altLink}
            onNeuLaden={neuLaden}
            onZahlung={nochKeinDialog}
            onBewertung={nochKeinDialog}
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

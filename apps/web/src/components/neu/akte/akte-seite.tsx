"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import type { AkteDaten } from "@/lib/akte";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import type { Gespraech } from "@/services/gespraech";
import { AblaufPanel } from "./ablauf-panel";
import { AkteDock, type DokumentArt } from "./akte-dock";
import { AkteKopf } from "./akte-kopf";
import { apiAufruf } from "./api";
import { BewertungDialog } from "./bewertung-dialog";
import { DokumentDialog } from "./dokument-dialog";
import { GespraechPanel } from "./gespraech-panel";
import { TerminDialog } from "@/components/neu/termin/termin-dialog";
import { VorlageDialog } from "./vorlage-dialog";
import { ZahlungDialog } from "./zahlung-dialog";
import { Zahlenreihe } from "./zahlenreihe";

export type GespraechDaten = Gespraech;

/** Der gerade offene Dialog des Docks (höchstens einer). */
type Dialog = { art: "zahlung" } | { art: "bewertung" } | { art: "vorlage" } | { art: "termin" } | { art: "dokument"; typ: DokumentArt };

/**
 * „Nachricht schreiben“: Fokus ins Eingabefeld des Gesprächs (`data-eingabe`
 * am Textfeld in `eingabe.tsx`). Ohne Feld (Ansicht Fotos, Dokumente, Notizen,
 * kein Kanal oder Fenster zu) ein Hinweis.
 */
function eingabeFokussieren() {
  const feld = document.querySelector<HTMLElement>('[data-slot="gespraech"] [data-eingabe]');
  if (feld) feld.focus();
  else toast.message("Kein Eingabefeld offen.", { description: "Ansicht „Chat“ wählen oder zuerst einen Kanal starten." });
}

type Zustand =
  | { art: "laden" }
  | { art: "nicht_gefunden" }
  | { art: "fehler"; meldung: string }
  | { art: "fertig"; akte: AkteDaten; gespraech: GespraechDaten };

/**
 * Die Umzugsakte: lädt `/akte` und `/gespraech` (Entscheidung 2), hält beide
 * im Zustand und gibt `neuLaden()` an die Kinder. Raster: Kopf, Zahlenreihe,
 * dann Gespräch links (mit dem Dock darunter) und Ablauf rechts (Spec 3.2).
 * Die Dialoge des Docks (Zahlung, Bewertung, Vorlage, Termin, Dokument) hängen
 * hier, damit Dock und Ablauf-Panel dieselben öffnen.
 *
 * Ein neuer `dealId` zeigt wieder das Skelett und schließt den Dialog. Schlägt
 * ein Neuladen nach einer Aktion fehl, bleibt die Seite stehen und ein Toast
 * erscheint; die Fehler- und 404-Ansicht gibt es nur, solange noch keine Akte da ist.
 */
export function AkteSeite({ dealId }: { dealId: string }) {
  const [zustand, setZustand] = useState<Zustand>({ art: "laden" });
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const portalZiel = usePortalZiel();
  const lauf = useRef(0);
  const hatAkte = useRef(false);
  hatAkte.current = zustand.art === "fertig";

  /** Lädt beides; gibt das frische Gespräch zurück (null bei Fehler oder überholtem Lauf). */
  const laden = useCallback(async (deal: string): Promise<GespraechDaten | null> => {
    const dieser = ++lauf.current;
    const stillOhneSeite = !hatAkte.current;
    const [a, g] = await Promise.all([
      apiAufruf<AkteDaten>(`/api/v1/deals/${deal}/akte`),
      apiAufruf<GespraechDaten>(`/api/v1/deals/${deal}/gespraech`),
    ]);
    if (dieser !== lauf.current) return null;
    if (a.ok && g.ok) {
      setZustand({ art: "fertig", akte: a.data, gespraech: g.data });
      return g.data;
    }
    const f = !a.ok ? a : !g.ok ? g : null;
    if (!f) return null;
    if (!stillOhneSeite) {
      toast.error("Akte konnte nicht neu geladen werden.", { description: f.message });
      return null;
    }
    setZustand(f.status === 404 ? { art: "nicht_gefunden" } : { art: "fehler", meldung: f.message });
    return null;
  }, []);

  useEffect(() => {
    hatAkte.current = false;
    setZustand({ art: "laden" });
    setDialog(null);
    void laden(dealId);
    return () => {
      lauf.current++;
    };
  }, [dealId, laden]);

  const neuLaden = useCallback(() => laden(dealId), [laden, dealId]);
  /** Für Kopf, Stufenmenü, Ablauf, Dock und Dialoge, die nur auf das Ende warten. */
  const neuLadenStill = useCallback(async () => {
    await neuLaden();
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

  const { akte, gespraech } = zustand;
  const schliessen = () => setDialog(null);
  /** Vorlagen nur über direkt verknüpfte WABA-Gespräche (Entscheidung 10). */
  const wabaKanaele = gespraech.kanaele.filter((k) => k.istWaba && k.direkt);
  const vorlageOeffnen = wabaKanaele.length > 0 ? () => setDialog({ art: "vorlage" }) : undefined;

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
        onNeuLaden={neuLadenStill}
      />
      <Zahlenreihe kacheln={akte.kacheln} />
      <div className="akte-koerper">
        <section className="akte-gespraech" data-slot="gespraech" aria-label="Gespräch">
          <GespraechPanel
            dealId={dealId}
            gespraech={gespraech}
            kundeName={akte.kopf.name}
            onNeuLaden={neuLaden}
            onVorlage={vorlageOeffnen}
          />
          <AkteDock
            dealId={dealId}
            dock={akte.dock}
            kvLink={akte.kvLink}
            hatWaba={wabaKanaele.length > 0}
            onZahlung={() => setDialog({ art: "zahlung" })}
            onBewertung={() => setDialog({ art: "bewertung" })}
            onDokument={(typ) => setDialog({ art: "dokument", typ })}
            onTermin={() => setDialog({ art: "termin" })}
            onVorlage={() => setDialog({ art: "vorlage" })}
            onNachricht={eingabeFokussieren}
            onNeuLaden={neuLadenStill}
          />
        </section>
        <aside className="akte-ablauf" data-slot="ablauf" aria-label="Ablauf">
          <AblaufPanel
            dealId={dealId}
            ablauf={akte.ablauf}
            zahlung={akte.zahlung}
            kalkulationLink={akte.kalkulationLink}
            bewertungErlaubt={akte.dock.bewertungErlaubt}
            onNeuLaden={neuLadenStill}
            onZahlung={() => setDialog({ art: "zahlung" })}
            onBewertung={() => setDialog({ art: "bewertung" })}
          />
        </aside>
      </div>

      {dialog?.art === "zahlung" ? (
        <ZahlungDialog dealId={dealId} zahlung={akte.zahlung} portalZiel={portalZiel} onSchliessen={schliessen} onNeuLaden={neuLadenStill} />
      ) : null}
      {dialog?.art === "bewertung" ? (
        <BewertungDialog dealId={dealId} portalZiel={portalZiel} onSchliessen={schliessen} onNeuLaden={neuLadenStill} />
      ) : null}
      {dialog?.art === "vorlage" ? (
        <VorlageDialog dealId={dealId} kanaele={wabaKanaele} portalZiel={portalZiel} onSchliessen={schliessen} onNeuLaden={neuLadenStill} />
      ) : null}
      {dialog?.art === "termin" ? (
        <TerminDialog
          dealId={dealId}
          portalZiel={portalZiel}
          onSchliessen={() => {
            // Der Termin steht in Kacheln und Ablauf: nach dem Dialog neu laden.
            schliessen();
            void neuLadenStill();
          }}
        />
      ) : null}
      {dialog?.art === "dokument" ? (
        <DokumentDialog
          dealId={dealId}
          art={dialog.typ}
          altLink={akte.altLink}
          portalZiel={portalZiel}
          onSchliessen={() => {
            // Eine erzeugte AB oder Rechnung steht in Dock, Kacheln und Ablauf: neu laden.
            schliessen();
            void neuLadenStill();
          }}
        />
      ) : null}
    </div>
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

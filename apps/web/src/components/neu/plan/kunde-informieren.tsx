"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import { apiAufruf } from "@/components/neu/akte/api";
import { akteUrl } from "@/components/neu/leads/lead-karte";
import { VorlageDialog } from "@/components/neu/akte/vorlage-dialog";
import { tagKurz } from "@/lib/anzeige";
import type { Gespraech, GespraechKanal } from "@/services/gespraech";

type Kanaele = { art: "laden" } | { art: "fehler"; meldung: string } | { art: "fertig"; waba: GespraechKanal[] };

/**
 * Schritt nach dem Speichern (Entscheidung 7): „Kunden informieren?“. Lädt
 * die WABA-Gespräche des Deals wie die Akte (`GET /deals/{id}/gespraech`,
 * nur direkt verknüpfte). „Vorlage senden“ öffnet den `VorlageDialog` der
 * Akte; ohne WABA-Kanal ein Hinweis und „Akte öffnen“. Es geht nichts raus
 * ohne eigenen Klick auf „Senden“ in der Vorlage.
 */
export function KundeInformieren({
  dealId,
  name,
  ziel,
  vorlage,
  portalZiel,
  onVorlage,
  onFertig,
}: {
  dealId: string;
  name: string;
  ziel: string;
  /** Die Vorlage ist geöffnet (Zustand „vorlage“). */
  vorlage: boolean;
  portalZiel: HTMLElement | undefined;
  onVorlage: () => void;
  onFertig: () => void;
}) {
  const [kanaele, setKanaele] = useState<Kanaele>({ art: "laden" });

  useEffect(() => {
    let aktiv = true;
    void apiAufruf<Gespraech>(`/api/v1/deals/${encodeURIComponent(dealId)}/gespraech`).then((r) => {
      if (!aktiv) return;
      setKanaele(r.ok ? { art: "fertig", waba: r.data.kanaele.filter((k) => k.istWaba && k.direkt) } : { art: "fehler", meldung: r.message });
    });
    return () => {
      aktiv = false;
    };
  }, [dealId]);

  if (vorlage && kanaele.art === "fertig" && kanaele.waba.length > 0) {
    return <VorlageDialog dealId={dealId} kanaele={kanaele.waba} portalZiel={portalZiel} onSchliessen={onFertig} onNeuLaden={() => undefined} />;
  }

  const ohneKanal = kanaele.art === "fertig" && kanaele.waba.length === 0;

  return (
    <GlassDialog open onOpenChange={(o) => !o && onFertig()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen">
        <GlassDialogTitle className="akte-dialog-titel">Kunden informieren?</GlassDialogTitle>
        <GlassDialogDescription className="akte-dialog-text">
          {name} steht jetzt auf {tagKurz(ziel)}. Im Portal sieht der Kunde das schon; eine Nachricht bekommt er nur, wenn du sie jetzt schickst.
        </GlassDialogDescription>
        {kanaele.art === "laden" ? <p className="plan-dialog-hinweis">Kanäle werden geladen …</p> : null}
        {kanaele.art === "fehler" ? (
          <p className="akte-dialog-fehler" role="alert">
            Kanäle konnten nicht geladen werden. {kanaele.meldung}
          </p>
        ) : null}
        {ohneKanal ? (
          <p className="plan-dialog-hinweis">Für diesen Kunden gibt es kein WhatsApp-Business-Gespräch. Schreib ihm aus der Akte.</p>
        ) : null}
        <div className="akte-dialog-knoepfe">
          <GlassButton type="button" variant="ghost" onClick={onFertig}>
            Nicht jetzt
          </GlassButton>
          {kanaele.art === "fertig" && kanaele.waba.length > 0 ? (
            <GlassButton type="button" onClick={onVorlage}>
              Vorlage senden
            </GlassButton>
          ) : kanaele.art === "laden" ? (
            <GlassButton type="button" disabled>
              Vorlage senden
            </GlassButton>
          ) : (
            <GlassButton asChild>
              <Link href={akteUrl(dealId)}>Akte öffnen</Link>
            </GlassButton>
          )}
        </div>
      </GlassDialogContent>
    </GlassDialog>
  );
}

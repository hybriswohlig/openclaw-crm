"use client";

import "@/styles/neu-akte-dock.css";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GenerateDocumentDialog, type DealData, type PrefilledPreise } from "@/components/GenerateDocumentDialog";
import { GlassButton } from "@/components/glassyui/glass-button";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import { vorbelegungAusAngebot, type Angebot } from "@/lib/angebot-vorbelegung";
import { buildDealDataForDocs, type LeadContext } from "@/lib/deal-doc-data";
import { apiAufruf } from "./api";
import type { DokumentArt } from "./akte-dock";

type Zustand =
  | { art: "laden" }
  | { art: "fehlt" }
  | { art: "fehler"; meldung: string }
  | { art: "bereit"; deal: DealData; prefill: PrefilledPreise | undefined };

/** Aus der Akte AB und Rechnung; die Kalkulationsseite öffnet den KV für Kottke (Plan 4, Entscheidung 6). */
export type DokumentDialogArt = DokumentArt | "KV";

const TITEL: Record<DokumentDialogArt, string> = { AB: "Auftragsbestätigung", RE: "Rechnung", KV: "Kostenvoranschlag" };

/**
 * AB und Rechnung (und KV für Kottke): Hülle um den bestehenden `GenerateDocumentDialog`
 * (Entscheidung 3). Die Deal-Daten kommen aus `GET /auftrag` (leadContext) über
 * `buildDealDataForDocs`, die Preise aus dem Angebot (`GET /quotation`) über
 * `vorbelegungAusAngebot`. Fehlen Firma oder Kundenname, steht der Hinweis mit
 * dem Link zur alten Akte. Der alte Dialog bringt seinen eigenen Rahmen mit und
 * wird deshalb nicht in einen Glas-Dialog gesetzt.
 */
export function DokumentDialog({
  dealId,
  art,
  altLink,
  portalZiel,
  onSchliessen,
  rechnung,
}: {
  dealId: string;
  art: DokumentDialogArt;
  altLink: string;
  portalZiel: HTMLElement | undefined;
  onSchliessen: () => void;
  /** Nur RE (Plan 9): Betrag und Grund aus dem Rechnungsschritt. */
  rechnung?: { bruttoCent: number; abweichungGrund?: string };
}) {
  const [zustand, setZustand] = useState<Zustand>({ art: "laden" });

  useEffect(() => {
    let aktuell = true;
    void Promise.all([
      apiAufruf<{ leadContext?: LeadContext | null }>(`/api/v1/deals/${dealId}/auftrag`),
      apiAufruf<Angebot | null>(`/api/v1/deals/${dealId}/quotation`),
    ]).then(([a, q]) => {
      if (!aktuell) return;
      if (!a.ok) return setZustand({ art: "fehler", meldung: a.message });
      const leadContext = a.data?.leadContext ?? null;
      const deal = leadContext ? buildDealDataForDocs(dealId, leadContext) : null;
      if (!deal) return setZustand({ art: "fehlt" });
      setZustand({ art: "bereit", deal, prefill: vorbelegungAusAngebot(q.ok ? (q.data ?? null) : null, deal.firma) });
    });
    return () => {
      aktuell = false;
    };
  }, [dealId]);

  if (zustand.art === "bereit") {
    // Alter, heller Dialog: im Dunkelmodus eigene dunkle Schrift (sonst hell auf Weiß).
    return (
      <div className="neu-alt-hell">
        <GenerateDocumentDialog
          open
          onClose={onSchliessen}
          documentType={art}
          deal={zustand.deal}
          prefill={zustand.prefill}
          rechnung={art === "RE" ? rechnung : undefined}
        />
      </div>
    );
  }

  return (
    <GlassDialog open onOpenChange={(offen) => !offen && onSchliessen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen">
        <GlassDialogTitle className="akte-dialog-titel">{TITEL[art]} erstellen</GlassDialogTitle>
        {zustand.art === "laden" ? <GlassDialogDescription className="akte-dialog-text">Deal-Daten werden geladen …</GlassDialogDescription> : null}
        {zustand.art === "fehler" ? <GlassDialogDescription className="akte-dialog-fehler">{zustand.meldung}</GlassDialogDescription> : null}
        {zustand.art === "fehlt" ? (
          <>
            <GlassDialogDescription className="akte-dialog-text">
              Ausführende Firma und Kundenname fehlen. Bitte in der alten Akte ergänzen.
            </GlassDialogDescription>
            <div className="akte-dialog-knoepfe">
              <GlassButton type="button" variant="ghost" onClick={onSchliessen}>
                Abbrechen
              </GlassButton>
              <GlassButton asChild>
                <Link href={altLink}>Alte Akte öffnen</Link>
              </GlassButton>
            </div>
          </>
        ) : null}
      </GlassDialogContent>
    </GlassDialog>
  );
}

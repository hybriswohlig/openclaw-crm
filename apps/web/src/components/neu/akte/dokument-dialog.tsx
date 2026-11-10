"use client";

import "@/styles/neu-akte-dock.css";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { GenerateDocumentDialog, type DealData, type PrefilledPreise } from "@/components/GenerateDocumentDialog";
import { GlassButton } from "@/components/glassyui/glass-button";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import { vorbelegungAusAngebot, type Angebot } from "@/lib/angebot-vorbelegung";
import type { LeadContext } from "@/lib/deal-doc-data";
import type { KvHinweisDaten, Vorpruefung } from "@/lib/kv-vorpruefung";
import { apiAufruf } from "./api";
import type { DokumentArt } from "./akte-dock";
import { AngabenDialog } from "./angaben-dialog";
import { dokumentStart } from "./dokument-start";

type Zustand =
  | { art: "laden" }
  | { art: "fehlt" }
  | { art: "preis_fehlt" }
  | { art: "angaben"; pruefung: Vorpruefung }
  | { art: "fehler"; meldung: string }
  | { art: "bereit"; deal: DealData; prefill: PrefilledPreise | undefined };

/** Aus der Akte AB und Rechnung; die Kalkulationsseite öffnet den KV für Kottke (Plan 4, Entscheidung 6). */
export type DokumentDialogArt = DokumentArt | "KV";

const TITEL: Record<DokumentDialogArt, string> = { AB: "Auftragsbestätigung", RE: "Rechnung", KV: "Kostenvoranschlag" };

/**
 * AB und Rechnung (und KV für Kottke): Hülle um den bestehenden `GenerateDocumentDialog`
 * (Entscheidung 3). Die Deal-Daten kommen aus `GET /auftrag` (leadContext) über
 * `buildDealDataForDocs`, die Preise aus dem Angebot (`GET /quotation`) über
 * `vorbelegungAusAngebot`. Vorher die Vorprüfung (`dokumentStart`, wie die alte
 * Oberfläche): fehlen Kundenname, Kundenanschrift (Auszug), Einzug oder Datum, kommt
 * „Es fehlen noch Angaben“ zum Nachtragen, danach direkt der Dokumentdialog. Fehlt
 * die Firma, steht der Hinweis mit dem Link zur alten Akte; fehlt bei AB oder
 * Rechnung das Angebot, der Link zur Kalkulation. Der alte Dialog bringt seinen
 * eigenen Rahmen mit und wird deshalb nicht in einen Glas-Dialog gesetzt.
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

  const pruefen = useCallback(
    async (istAktuell: () => boolean) => {
      const [a, q] = await Promise.all([
        apiAufruf<{ leadContext?: LeadContext | null; kvHinweise?: KvHinweisDaten | null }>(`/api/v1/deals/${dealId}/auftrag`),
        apiAufruf<Angebot | null>(`/api/v1/deals/${dealId}/quotation`),
      ]);
      if (!istAktuell()) return;
      if (!a.ok) return setZustand({ art: "fehler", meldung: a.message });
      const start = dokumentStart(dealId, a.data?.leadContext ?? null, a.data?.kvHinweise ?? null, art);
      if (start.art === "firma_fehlt") return setZustand({ art: "fehlt" });
      if (start.art === "preis_fehlt") return setZustand({ art: "preis_fehlt" });
      if (start.art === "angaben") return setZustand({ art: "angaben", pruefung: start.pruefung });
      setZustand({ art: "bereit", deal: start.deal, prefill: vorbelegungAusAngebot(q.ok ? (q.data ?? null) : null, start.deal.firma) });
    },
    [dealId, art]
  );

  useEffect(() => {
    let aktuell = true;
    void pruefen(() => aktuell);
    return () => {
      aktuell = false;
    };
  }, [pruefen]);

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

  if (zustand.art === "angaben") {
    return (
      <AngabenDialog
        dealId={dealId}
        art={art}
        pruefung={zustand.pruefung}
        portalZiel={portalZiel}
        onSchliessen={onSchliessen}
        onWeiter={() => {
          setZustand({ art: "laden" });
          void pruefen(() => true);
        }}
      />
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
              Am Lead fehlt die ausführende Firma (Kottke oder Ceylan). Bitte in der alten Akte ergänzen.
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
        {zustand.art === "preis_fehlt" ? (
          <>
            <GlassDialogDescription className="akte-dialog-text">
              Für {art === "RE" ? "die Rechnung" : "die Auftragsbestätigung"} braucht es zuerst ein gespeichertes Angebot.
            </GlassDialogDescription>
            <div className="akte-dialog-knoepfe">
              <GlassButton type="button" variant="ghost" onClick={onSchliessen}>
                Abbrechen
              </GlassButton>
              <GlassButton asChild>
                <Link href={`/app/leads/${encodeURIComponent(dealId)}/kalkulation`}>Kalkulation öffnen</Link>
              </GlassButton>
            </div>
          </>
        ) : null}
      </GlassDialogContent>
    </GlassDialog>
  );
}

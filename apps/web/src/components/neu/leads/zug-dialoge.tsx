"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import { apiAufruf } from "@/components/neu/akte/api";
import { ZahlungDialog } from "@/components/neu/akte/zahlung-dialog";
import { stufeSetzen } from "@/components/neu/stufen-wechsel/stufe-setzen";
import { StufenDialog } from "@/components/neu/stufen-wechsel/stufen-dialog";
import type { AkteDaten } from "@/lib/akte";
import { zugDialogText, type LeadKategorie, type LeadsStammdaten, type ZugDialogText } from "@/lib/leads-board";
import { bezahltRueckfrageText, nachZahlungFolge, type Zug } from "./leads-logik";

export interface ZugErgebnis {
  /** Die Oberfläche hat die Stufe selbst gesetzt (Toast „Stufe auf … gesetzt.“). */
  stufeGesetzt: boolean;
  /** Etwas hat sich geändert: Board bzw. Liste neu laden. */
  neuLaden: boolean;
}

/** Was der Zahlungsdialog hinterlässt, aus der zuletzt geladenen Akte. */
export interface ZahlungEnde {
  /** Mindestens einmal gespeichert, bestätigt oder verworfen. */
  geaendert: boolean;
  restVorher: number | null;
  restNachher: number | null;
  kategorieNachher: LeadKategorie | null;
  /** Das letzte Laden von `/akte` schlug fehl: Rest und Stufe sind unbekannt. */
  fehler: boolean;
}

/**
 * Zahlung erfassen aus dem Board: lädt `zahlung` (Rest und offene Meldungen)
 * über `GET /deals/{id}/akte`, zeigt den `ZahlungDialog` der Akte und lädt
 * nach jeder Buchung dieselbe Akte neu (Entscheidung 4). Beim Schließen
 * meldet sie Rest und Stufe danach.
 */
export function ZahlungAusAkte({
  dealId,
  portalZiel,
  onSchliessen,
}: {
  dealId: string;
  portalZiel: HTMLElement | undefined;
  onSchliessen: (ende: ZahlungEnde) => void;
}) {
  const [akte, setAkte] = useState<AkteDaten | null>(null);
  const ende = useRef<ZahlungEnde>({ geaendert: false, restVorher: null, restNachher: null, kategorieNachher: null, fehler: false });
  const schliessen = useRef(onSchliessen);
  schliessen.current = onSchliessen;

  const laden = useCallback(async (): Promise<boolean> => {
    const r = await apiAufruf<AkteDaten>(`/api/v1/deals/${encodeURIComponent(dealId)}/akte`);
    if (!r.ok) {
      ende.current.fehler = true;
      toast.error("Zahlung konnte nicht geöffnet werden.", { description: r.message });
      return false;
    }
    const e = ende.current;
    e.fehler = false;
    if (e.restVorher === null && !e.geaendert) e.restVorher = r.data.zahlung.restCent;
    e.restNachher = r.data.zahlung.restCent;
    e.kategorieNachher = r.data.kopf.stufe.kategorie as LeadKategorie | null;
    setAkte(r.data);
    return true;
  }, [dealId]);

  useEffect(() => {
    let aktiv = true;
    void laden().then((ok) => {
      if (aktiv && !ok) schliessen.current(ende.current);
    });
    return () => {
      aktiv = false;
    };
  }, [laden]);

  if (!akte) return null;
  return (
    <ZahlungDialog
      dealId={dealId}
      zahlung={akte.zahlung}
      portalZiel={portalZiel}
      onSchliessen={() => schliessen.current(ende.current)}
      onNeuLaden={async () => {
        ende.current.geaendert = true;
        await laden();
      }}
    />
  );
}

type Schritt =
  /** `abbruchNeuLaden`: vorher wurde schon etwas gebucht, auch Abbrechen muss neu laden. */
  | { art: "frage"; text: ZugDialogText; danach: "setzen" | "kalkulation"; abbruchNeuLaden: boolean }
  | { art: "verlust" }
  | { art: "zahlung" }
  | { art: "setzen" };

function startSchritt(zug: Zug): Schritt {
  switch (zug.aktion.art) {
    case "setzen":
      return { art: "setzen" };
    case "verlustgrund":
      return { art: "verlust" };
    case "zahlung":
      return { art: "zahlung" };
    case "keine":
      return { art: "setzen" };
    default: {
      const text = zugDialogText(zug.aktion, zug.von.label, zug.nach.label, zug.karte.fakten);
      return text
        ? { art: "frage", text, danach: zug.aktion.art === "kv" ? "kalkulation" : "setzen", abbruchNeuLaden: false }
        : { art: "setzen" };
    }
  }
}

/**
 * Die Dialoge eines Zugs (Entscheidungen 3 bis 5): Rückfrage, Beauftragung
 * mit Pflichthaken, Hinweis „KV erstellen“ mit Weg zur Kalkulation,
 * Verlustgrund (`StufenDialog` der Akte), Zahlung (`ZahlungDialog` der Akte)
 * mit der Folge nach dem Schließen; „setzen“ schreibt sofort. Jede Stufe
 * geht über `stufeSetzen`. Abbrechen und Fehler enden ohne Änderung, die
 * Karte springt zurück.
 */
export function ZugDialoge({
  zug,
  stammdaten,
  portalZiel,
  onEnde,
}: {
  zug: Zug;
  stammdaten: Pick<LeadsStammdaten, "verlustGruende">;
  portalZiel: HTMLElement | undefined;
  onEnde: (ergebnis: ZugErgebnis) => void;
}) {
  const router = useRouter();
  const [schritt, setSchritt] = useState<Schritt>(() => startSchritt(zug));
  const [speichert, setSpeichert] = useState(false);
  const gestartet = useRef(false);
  const ende = useRef(onEnde);
  ende.current = onEnde;

  const setzen = useCallback(
    async (verlust?: { grund: string; notiz: string }): Promise<string | null> => {
      setSpeichert(true);
      const fehler = await stufeSetzen(zug.karte.id, zug.nach.stufeId, verlust);
      setSpeichert(false);
      if (fehler) return fehler;
      ende.current({ stufeGesetzt: true, neuLaden: true });
      return null;
    },
    [zug.karte.id, zug.nach.stufeId]
  );

  // Ohne Dialog: sofort schreiben, genau einmal (auch im Strict Mode).
  useEffect(() => {
    if (schritt.art !== "setzen" || gestartet.current) return;
    gestartet.current = true;
    void setzen().then((fehler) => {
      if (fehler) {
        toast.error("Stufe konnte nicht gesetzt werden.", { description: fehler });
        ende.current({ stufeGesetzt: false, neuLaden: false });
      }
    });
  }, [schritt.art, setzen]);

  if (schritt.art === "setzen") return null;

  if (schritt.art === "verlust") {
    return (
      <StufenDialog
        portalZiel={portalZiel}
        von={zug.von.label}
        ziel={{ id: zug.nach.stufeId, label: zug.nach.label, kategorie: zug.nach.kategorie }}
        grundNoetig
        verlustGruende={stammdaten.verlustGruende}
        speichert={speichert}
        onAbbrechen={() => onEnde({ stufeGesetzt: false, neuLaden: false })}
        onBestaetigen={(verlust) => setzen(verlust)}
      />
    );
  }

  if (schritt.art === "zahlung") {
    return (
      <ZahlungAusAkte
        dealId={zug.karte.id}
        portalZiel={portalZiel}
        onSchliessen={(e) => {
          const gebucht = e.geaendert && (e.restVorher === null || e.restVorher !== e.restNachher);
          const folge = nachZahlungFolge({
            gebucht,
            vonKategorie: zug.von.kategorie,
            neueKategorie: e.geaendert ? e.kategorieNachher : zug.von.kategorie,
            restCent: e.restNachher,
            fehler: e.fehler,
          });
          switch (folge.art) {
            case "bleibt":
              onEnde({ stufeGesetzt: false, neuLaden: true });
              return;
            case "rueckfrage":
              setSchritt({
                art: "frage",
                text: bezahltRueckfrageText(e.restNachher, zug.nach.label),
                danach: "setzen",
                abbruchNeuLaden: e.geaendert,
              });
              return;
            case "fehler":
              // Ohne lesbare Zahlungsdaten keine Rückfrage; der Fehler steht schon im Toast, die Karte springt zurück.
              onEnde({ stufeGesetzt: false, neuLaden: e.geaendert });
              return;
            case "toast":
              toast.message(folge.text);
              onEnde({ stufeGesetzt: false, neuLaden: true });
              return;
            case "nichts":
              onEnde({ stufeGesetzt: false, neuLaden: e.geaendert });
              return;
          }
        }}
      />
    );
  }

  return (
    <FrageDialog
      text={schritt.text}
      portalZiel={portalZiel}
      speichert={speichert}
      onAbbrechen={() => onEnde({ stufeGesetzt: false, neuLaden: schritt.abbruchNeuLaden })}
      onBestaetigen={async () => {
        if (schritt.danach === "kalkulation") {
          router.push(zug.karte.kvLink);
          onEnde({ stufeGesetzt: false, neuLaden: false });
          return null;
        }
        return setzen();
      }}
    />
  );
}

/** Rückfrage mit Titel, Text, optionalem Pflichthaken und einem Knopf; Fehler bleiben im Dialog. */
function FrageDialog({
  text,
  portalZiel,
  speichert,
  onAbbrechen,
  onBestaetigen,
}: {
  text: ZugDialogText;
  portalZiel: HTMLElement | undefined;
  speichert: boolean;
  onAbbrechen: () => void;
  onBestaetigen: () => Promise<string | null>;
}) {
  const id = useId();
  const [haken, setHaken] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const bereit = text.haken === null || haken;

  async function absenden(e: React.FormEvent) {
    e.preventDefault();
    if (!bereit) return setFehler("Bitte zuerst bestätigen.");
    setFehler(null);
    const problem = await onBestaetigen();
    if (problem) setFehler(problem);
  }

  return (
    <GlassDialog open onOpenChange={(offen) => !offen && !speichert && onAbbrechen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen">
        <GlassDialogTitle className="akte-dialog-titel">{text.titel}</GlassDialogTitle>
        <GlassDialogDescription className="akte-dialog-text">{text.text}</GlassDialogDescription>
        <form onSubmit={(e) => void absenden(e)}>
          {text.haken ? (
            <label className="leads-dialog-haken" htmlFor={id}>
              <input id={id} type="checkbox" checked={haken} onChange={(e) => setHaken(e.target.checked)} />
              {text.haken}
            </label>
          ) : null}
          {fehler ? <p className="akte-dialog-fehler">{fehler}</p> : null}
          <div className="akte-dialog-knoepfe">
            <GlassButton type="button" variant="ghost" onClick={onAbbrechen} disabled={speichert}>
              Abbrechen
            </GlassButton>
            <GlassButton type="submit" disabled={speichert || !bereit}>
              {speichert ? "Speichert" : text.knopf}
            </GlassButton>
          </div>
        </form>
      </GlassDialogContent>
    </GlassDialog>
  );
}

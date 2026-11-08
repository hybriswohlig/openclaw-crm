"use client";

import "@/styles/neu-bewertungen.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import { GlassSegmentedControl, GlassSegmentedControlItem } from "@/components/glassyui/glass-segmented-control";
import { apiAufruf, jsonAufruf } from "@/components/neu/akte/api";
import { BewertungDialog } from "@/components/neu/akte/bewertung-dialog";
import { seitentitel } from "@/components/neu/nav-config";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import type { BewertungenAntwort, BewertungListe, BewertungModus, BewertungZeile } from "@/lib/bewertungen-kunden";
import { BewertungListeAnsicht } from "./bewertung-liste";
import { FirmenLeiste } from "./firmen-leiste";
import { LISTE_TITEL, LISTEN, startListe, type ZeilenAktion } from "./bewertungen-logik";

type Zustand = { art: "laden" } | { art: "fehler"; meldung: string } | { art: "fertig"; antwort: BewertungenAntwort };

/**
 * /app/bewertungen (Plan 11, Entscheidung 12): Firmen-Leiste mit Modus und
 * Portal-Haken, Zähler je Liste, eine Liste zur Zeit (Zur Freigabe,
 * Vorgemerkt, Fällig, Angefragt, Geklickt, Gesperrt), Altsperren nur als
 * Zahl. „Prüfen und senden“ öffnet denselben Dialog wie die Akte.
 */
export function BewertungenSeite() {
  const portalZiel = usePortalZiel();
  const [firma, setFirma] = useState("alle");
  const [liste, setListe] = useState<BewertungListe | null>(null);
  const [zustand, setZustand] = useState<Zustand>({ art: "laden" });
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [speichert, setSpeichert] = useState<string | null>(null);
  const [dialog, setDialog] = useState<string | null>(null);
  const [freigeben, setFreigeben] = useState<BewertungZeile | null>(null);
  const lauf = useRef(0);

  const laden = useCallback(
    async (still = false) => {
      const dieser = ++lauf.current;
      if (!still) setZustand({ art: "laden" });
      const r = await apiAufruf<BewertungenAntwort>(
        `/api/v1/bewertungen${firma !== "alle" ? `?firma=${encodeURIComponent(firma)}` : ""}`
      );
      if (dieser !== lauf.current) return;
      if (r.ok) setZustand({ art: "fertig", antwort: r.data });
      else if (still) toast.error("Bewertungen konnten nicht neu geladen werden.", { description: r.message });
      else setZustand({ art: "fehler", meldung: r.message });
    },
    [firma]
  );

  useEffect(() => {
    void laden();
  }, [laden]);

  const a = zustand.art === "fertig" ? zustand.antwort : null;
  const aktiv: BewertungListe = liste ?? (a ? startListe(a.zaehler) : "faellig");
  const zeilen = useMemo(() => (a ? a.zeilen.filter((z) => z.liste === aktiv) : []), [a, aktiv]);

  async function setzen(ocId: string, e: { modus?: BewertungModus; hakenPortal?: boolean }) {
    setSpeichert(ocId);
    const r = await apiAufruf(`/api/v1/bewertungen/firmen/${ocId}`, jsonAufruf("PUT", e));
    setSpeichert(null);
    if (!r.ok) {
      toast.error("Nicht gespeichert.", { description: r.message });
      return;
    }
    toast.success(e.modus ? "Automatik gespeichert." : e.hakenPortal ? "Portal fragt bei der Annahme nach." : "Portal fragt nicht mehr nach.");
    await laden(true);
  }

  async function aktion(z: BewertungZeile, art: ZeilenAktion) {
    if (art === "pruefen") return setDialog(z.dealId);
    if (art === "freigeben") return setFreigeben(z);
    if (!z.vormerkungId) return;
    setLaeuft(z.dealId);
    const r = await apiAufruf(`/api/v1/bewertungen/vormerkungen/${z.vormerkungId}`, jsonAufruf("PATCH", { aktion: "verwerfen" }));
    setLaeuft(null);
    if (r.ok) toast.success("Verworfen.");
    else toast.error("Nicht verworfen.", { description: r.message });
    await laden(true);
  }

  async function tokenFreigeben(z: BewertungZeile) {
    setLaeuft(z.dealId);
    const r = await apiAufruf(`/api/v1/deals/${z.dealId}/review-request/freigeben`, jsonAufruf("POST", {}));
    setLaeuft(null);
    setFreigeben(null);
    if (r.ok) toast.success("Freigegeben. Die Anfrage kann neu gesendet werden.");
    else toast.error("Nicht freigegeben.", { description: r.message });
    await laden(true);
  }

  const offen = a ? a.zaehler.freigabe + a.zaehler.faellig : 0;
  const zweite = a
    ? offen > 0
      ? `${offen} ${offen === 1 ? "Anfrage wartet" : "Anfragen warten"} auf euch`
      : "Nichts wartet auf euch"
    : "Bewertungsanfragen nach dem Umzug";

  return (
    <div className="bew">
      <header className="neu-kopf bew-kopf">
        <div>
          <h1>{seitentitel("/app/bewertungen")}</h1>
          <p className="neu-kopf-zweite">{zweite}</p>
        </div>
        {a && a.firmen.length > 1 ? (
          <div className="bew-filter">
            <GlassSegmentedControl value={firma} onValueChange={(v) => v && setFirma(v)} aria-label="Firma">
              <GlassSegmentedControlItem value="alle">Alle</GlassSegmentedControlItem>
              {a.firmen.map((f) => (
                <GlassSegmentedControlItem key={f.id} value={f.id}>
                  {f.name.trim().split(/\s+/)[0]}
                </GlassSegmentedControlItem>
              ))}
            </GlassSegmentedControl>
          </div>
        ) : null}
      </header>

      {zustand.art === "laden" ? (
        <div className="bew-laden" aria-busy="true" aria-label="Bewertungen werden geladen">
          <span className="lg-skeleton bew-skelett" />
          <span className="lg-skeleton bew-skelett" />
        </div>
      ) : null}

      {zustand.art === "fehler" ? (
        <div className="bew-hinweis" role="alert">
          <p>Bewertungen konnten nicht geladen werden. {zustand.meldung}</p>
          <GlassButton size="sm" onClick={() => void laden()}>
            Erneut versuchen
          </GlassButton>
        </div>
      ) : null}

      {a ? (
        <>
          <FirmenLeiste
            firmen={firma === "alle" ? a.firmen : a.firmen.filter((f) => f.id === firma)}
            portalZiel={portalZiel}
            speichert={speichert}
            onSetzen={(id, e) => void setzen(id, e)}
          />

          <ul className="bew-zaehler" aria-label="Listen">
            {LISTEN.map((l) => (
              <li key={l}>
                <button
                  type="button"
                  className="bew-zaehler-knopf"
                  aria-pressed={aktiv === l}
                  data-arbeit={(l === "freigabe" || l === "faellig") && a.zaehler[l] > 0 ? true : undefined}
                  onClick={() => setListe(l)}
                >
                  <span className="bew-zaehler-titel">{LISTE_TITEL[l]}</span>
                  <b className="bew-zaehler-wert">{a.zaehler[l]}</b>
                </button>
              </li>
            ))}
          </ul>

          <BewertungListeAnsicht liste={aktiv} zeilen={zeilen} laeuft={laeuft} onAktion={(z, art) => void aktion(z, art)} />

          {a.altsperren > 0 ? (
            <p className="bew-fuss">
              {a.altsperren} {a.altsperren === 1 ? "Altsperre" : "Altsperren"} aus der Umstellung vom 09.05.2026
            </p>
          ) : null}
        </>
      ) : null}

      {dialog ? (
        <BewertungDialog
          dealId={dialog}
          portalZiel={portalZiel}
          onSchliessen={() => setDialog(null)}
          onNeuLaden={() => laden(true)}
        />
      ) : null}

      {freigeben ? (
        <GlassDialog open onOpenChange={(o) => !o && laeuft === null && setFreigeben(null)}>
          <GlassDialogContent container={portalZiel} closeLabel="Schließen">
            <GlassDialogTitle className="akte-dialog-titel">Versand unklar freigeben?</GlassDialogTitle>
            <GlassDialogDescription className="akte-dialog-text">
              Nur freigeben, wenn im Gespräch mit {freigeben.kunde?.name ?? "dem Kunden"} keine Bewertungsanfrage angekommen ist.
              Danach kann die Anfrage neu gesendet werden.
            </GlassDialogDescription>
            <div className="akte-dialog-knoepfe">
              <GlassButton type="button" variant="ghost" onClick={() => setFreigeben(null)} disabled={laeuft !== null}>
                Abbrechen
              </GlassButton>
              <GlassButton type="button" onClick={() => void tokenFreigeben(freigeben)} disabled={laeuft !== null}>
                Im Gespräch geprüft, freigeben
              </GlassButton>
            </div>
          </GlassDialogContent>
        </GlassDialog>
      ) : null}
    </div>
  );
}

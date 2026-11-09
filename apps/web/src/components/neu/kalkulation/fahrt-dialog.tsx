"use client";

import "@/styles/neu-kalk-p15.css";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassDialog, GlassDialogContent, GlassDialogDescription, GlassDialogTitle } from "@/components/glassyui/glass-dialog";
import { apiAufruf } from "@/components/neu/akte/api";
import type { FahrtAnsicht } from "@/lib/kalkulation-annahmen";
import { fahrtGoogleLink, fahrtLinien, STRECKEN_FARBE, streckenLabel } from "./fahrt-karte-logik";
import type { RouteDaten } from "./route-karte";

const FahrtKarteBild = dynamic(() => import("./fahrt-karte-bild"), {
  ssr: false,
  loading: () => <span className="lg-skeleton" style={{ position: "absolute", inset: 0 }} />,
});

const KM = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

/**
 * Routen-Popup der Fahrt (Plan 15, Bauteil 12): Karte mit jeder Strecke in eigener
 * Farbe (gewählte hervorgehoben, geschätzte gestrichelt), Tabelle je Strecke mit
 * Minuten, Kilometern und Quelle, die Rechnung in Klartext, „In Google Maps öffnen“
 * mit allen Wegpunkten und der Weg zur Fahrzeit-Übersteuerung (Bauteil 11).
 * `vorschau` ersetzt den Abruf der Route (Testdaten, Sichtprüfung).
 */
export function FahrtDialog({
  dealId,
  versionNr,
  fahrt,
  start,
  portalZiel,
  onSchliessen,
  onFahrzeitenAendern,
  onFahrtzeileAendern,
  vorschau,
}: {
  dealId: string;
  versionNr: number;
  fahrt: FahrtAnsicht;
  /** Schlüssel der Strecke, die hervorgehoben startet; null = alle */
  start: string | null;
  portalZiel: HTMLElement | undefined;
  onSchliessen: () => void;
  onFahrzeitenAendern?: () => void;
  onFahrtzeileAendern?: () => void;
  vorschau?: RouteDaten;
}) {
  const [aktiv, setAktiv] = useState<string | null>(start);
  const [route, setRoute] = useState<RouteDaten | null>(vorschau ?? null);
  useEffect(() => {
    if (vorschau) return;
    let lebt = true;
    void apiAufruf<RouteDaten>(`/api/v1/deals/${encodeURIComponent(dealId)}/calculation/versions/${versionNr}/route-karte`).then((r) => {
      if (lebt && r.ok) setRoute(r.data);
    });
    return () => {
      lebt = false;
    };
  }, [dealId, versionNr, vorschau]);

  const linien = useMemo(() => fahrtLinien(fahrt.strecken, route?.status === "ok" ? route.teilstrecken : []), [fahrt.strecken, route]);
  const touren = fahrt.strecken.filter((s) => s.art === "tour").length;
  const link = fahrtGoogleLink(fahrt.punkte, touren);
  const geschaetzt = fahrt.strecken.filter((s) => s.geschaetzt).length;

  return (
    <GlassDialog open onOpenChange={(offen) => !offen && onSchliessen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen" className="kalk-fahrt-dialog">
        <GlassDialogTitle className="akte-dialog-titel">Fahrt</GlassDialogTitle>
        <GlassDialogDescription className="akte-dialog-text">
          Station, Beladen, jede Tour und die Rückfahrt. Klick auf eine Zeile hebt die Strecke hervor.
        </GlassDialogDescription>
        <div className="kalk-fahrt-karte">
          {linien.length > 0 ? (
            <FahrtKarteBild linien={linien} aktiv={aktiv} />
          ) : (
            <p className="kalk-karte-leer">
              {route === null && !vorschau ? "Route wird geladen …" : "Keine Route: alle Strecken sind geschätzt, ohne Adressen gibt es keine Punkte für die Karte."}
            </p>
          )}
        </div>
        <table className="kalk-fahrt-tabelle">
          <thead>
            <tr>
              <th scope="col">Strecke</th>
              <th scope="col">min</th>
              <th scope="col">km</th>
              <th scope="col">Quelle</th>
            </tr>
          </thead>
          <tbody>
            {fahrt.strecken.map((s) => (
              <tr
                key={s.key}
                data-aktiv={aktiv === s.key ? "" : undefined}
                data-geschaetzt={s.geschaetzt ? "" : undefined}
                tabIndex={0}
                onClick={() => setAktiv(aktiv === s.key ? null : s.key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setAktiv(aktiv === s.key ? null : s.key);
                  }
                }}
                aria-selected={aktiv === s.key}
              >
                <td>
                  <i className="kalk-fahrt-farbe" style={{ background: STRECKEN_FARBE[s.art] }} data-gestrichelt={s.geschaetzt ? "" : undefined} aria-hidden="true" />
                  {streckenLabel(s)}
                </td>
                <td>{s.min}</td>
                <td>{KM.format(s.km)}</td>
                <td>
                  <span className="kalk-marke" data-ton={s.quelle === "google" ? "blau" : s.quelle === "manuell" ? "gold" : "grau"}>
                    {s.quelleText}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>{fahrt.rechnung}</td>
            </tr>
          </tfoot>
        </table>
        {fahrt.hinweis ? <p className="kalk-dialog-hinweis">{fahrt.hinweis}</p> : null}
        {geschaetzt > 0 ? (
          <p className="kalk-fahrt-hinweis">
            {geschaetzt === fahrt.strecken.length ? "Alle Strecken sind geschätzt." : `${geschaetzt} von ${fahrt.strecken.length} Strecken sind geschätzt.`} Mit echten
            Minuten, etwa laut Google Maps, rechnet der Rechner genauer.
          </p>
        ) : null}
        <div className="akte-dialog-knoepfe kalk-fahrt-knoepfe">
          {link ? (
            <a className="kalk-kleinknopf" href={link} target="_blank" rel="noreferrer">
              In Google Maps öffnen
            </a>
          ) : null}
          {onFahrtzeileAendern ? (
            <GlassButton type="button" variant="ghost" onClick={onFahrtzeileAendern}>
              Betrag der Fahrtzeile ändern
            </GlassButton>
          ) : null}
          {onFahrzeitenAendern ? (
            <GlassButton type="button" onClick={onFahrzeitenAendern}>
              Fahrzeiten ändern
            </GlassButton>
          ) : null}
        </div>
      </GlassDialogContent>
    </GlassDialog>
  );
}

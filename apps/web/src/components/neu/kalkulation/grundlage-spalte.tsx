"use client";

import "@/styles/neu-kalk-grundlage.css";

import { useState } from "react";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import type { GrundlageAnsicht, GrundlageAnsichtZeile } from "@/lib/kalkulations-ansicht";
import { EingabeDialog } from "./eingabe-dialog";
import { FotoDialog, trefferText, type Foto } from "./foto-dialog";
import { GrundlageZeile } from "./grundlage-zeile";
import type { KalkKontext } from "./kalk-seite";
import { RouteKarte, type RouteDaten } from "./route-karte";
import { StreetViewKasten, type StreetViewDaten, type StreetViewSeite } from "./street-view-kasten";

/** Höchstens zwei Reihen à sieben Fotos; der Rest als „+N“-Kachel. */
const FOTOS_MAX = 14;

type Dialog = { art: "eingabe"; zeile: GrundlageAnsichtZeile } | { art: "foto"; foto: Foto; nummer: number };

/**
 * Linke Spalte „Grundlage“: Fotostreifen (7 Spalten, violette Treffermarken,
 * Klick öffnet den Foto-Dialog), Zeilen mit Herkunft (Klick öffnet den
 * Eingabe-Dialog), Street View unter Beladen und Entladen, unten die Route.
 * `vorschau` liefert Street View und Route ohne Abruf (Fixture, Tests).
 */
export function GrundlageSpalte({
  grundlage,
  kontext,
  vorschau,
}: {
  grundlage: GrundlageAnsicht;
  kontext: KalkKontext;
  vorschau?: { streetView: Record<StreetViewSeite, StreetViewDaten | undefined>; route: RouteDaten };
}) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const portalZiel = usePortalZiel();
  const beschaeftigt = kontext.laeuft !== null;
  const fotos = grundlage.fotos.slice(0, FOTOS_MAX);
  const weitere = grundlage.fotosGesamt - fotos.length;

  const streetView = (seite: StreetViewSeite) =>
    grundlage.adressen[seite] ? (
      <StreetViewKasten
        dealId={kontext.dealId}
        versionNr={kontext.versionNr}
        seite={seite}
        beschaeftigt={beschaeftigt}
        vorschau={vorschau?.streetView[seite]}
      />
    ) : null;

  return (
    <GlassPanel variant="panel" className="kalk-panel" aria-label="Grundlage">
      <div className="kalk-panel-kopf">
        <div>
          <h2 className="kalk-panel-titel">Grundlage</h2>
          <p className="kalk-panel-unter">Woher jede Zahl kommt. Klick zum Ändern.</p>
        </div>
      </div>

      {fotos.length > 0 ? (
        <div className="kalk-fotos" role="list" aria-label={`${grundlage.fotosGesamt} Fotos`}>
          {fotos.map((f, i) => {
            const erster = f.treffer[0];
            return (
              <button
                key={f.id}
                type="button"
                role="listitem"
                className="kalk-foto"
                onClick={() => setDialog({ art: "foto", foto: f, nummer: i + 1 })}
                title={f.treffer.length > 0 ? f.treffer.map(trefferText).join(", ") : `Foto ${i + 1}`}
                aria-label={`Foto ${i + 1} von ${grundlage.fotosGesamt}${f.treffer.length > 0 ? `: ${f.treffer.map(trefferText).join(", ")}` : ""}`}
              >
                <img src={f.url} alt="" loading="lazy" />
                {erster ? (
                  <span className="kalk-foto-treffer" aria-hidden="true">
                    {trefferText(erster)}
                    {f.treffer.length > 1 ? ` +${f.treffer.length - 1}` : ""}
                  </span>
                ) : null}
              </button>
            );
          })}
          {weitere > 0 ? (
            <span className="kalk-foto kalk-foto-mehr" role="listitem" title={`${weitere} weitere Fotos in der Akte`}>
              +{weitere}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="kalk-fotos-leer">Noch keine Fotos vom Kunden.</p>
      )}

      <div className="kalk-liste">
        {grundlage.zeilen.map((z) => (
          <GrundlageZeile key={z.key} zeile={z} beschaeftigt={beschaeftigt} onBearbeiten={z.felder.length > 0 ? (zeile) => setDialog({ art: "eingabe", zeile }) : undefined}>
            {z.key === "beladen" ? streetView("beladen") : z.key === "entladen" ? streetView("entladen") : null}
          </GrundlageZeile>
        ))}
      </div>

      <RouteKarte dealId={kontext.dealId} versionNr={kontext.versionNr} vorschau={vorschau?.route} />

      {dialog?.art === "eingabe" ? (
        <EingabeDialog zeile={dialog.zeile} kontext={kontext} portalZiel={portalZiel} onSchliessen={() => setDialog(null)} />
      ) : null}
      {dialog?.art === "foto" ? (
        <FotoDialog foto={dialog.foto} nummer={dialog.nummer} gesamt={grundlage.fotosGesamt} portalZiel={portalZiel} onSchliessen={() => setDialog(null)} />
      ) : null}
    </GlassPanel>
  );
}

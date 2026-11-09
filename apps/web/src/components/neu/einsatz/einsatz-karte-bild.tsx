"use client";
/**
 * Die Karte der Einsatz-Ansicht (Plan 12c, Entscheidung 6): MapLibre mit
 * OpenFreeMap wie die Routenkarte (`route-karte-bild.tsx`), Stil folgt der
 * Darstellung (positron hell, dark dunkel). Hauptstrecke Vermilion 5 px,
 * Beladen weißer Punkt mit Vermilion-Rand und Ablagekreis, Entladen Vermilion
 * gefüllt, Umkreis als gestrichelter Ring, gestrichelte Gerade Wohnort →
 * Beladen für Ausgewählte, Pins als Marker. Nur im Browser (next/dynamic).
 */
import { setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Layer, Map as MapLibreKarte, Marker, Source, type MapRef } from "@vis.gl/react-maplibre";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useDarstellung } from "@/components/neu/darstellung";
import { kartenStil, stationsFarbe } from "@/components/neu/kalkulation/karten-stil";
import { kartenGrenzen, kreisPunkte, type KartenAuftragPunkt, type PinGruppe, type Punkt, type UmkreisKm } from "@/lib/einsatz";

setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());

/** WebGL kennt keine CSS-Variablen: Markenfarben wie die Routenkarte, Grau je Theme aus TOKENS. */
const VERMILION = "#f04a28";
const BLAU = "#0067d9";

export interface KartenSteuerung {
  /** Karte schieben an oder aus (während eine Person gezogen wird aus). */
  schieben(an: boolean): void;
}

export interface EinsatzKarteBildProps {
  beladen: KartenAuftragPunkt | null;
  entladen: KartenAuftragPunkt | null;
  linie: Punkt[];
  gruppen: PinGruppe[];
  /** Punkte der ausgewählten Personen für die gestrichelte Gerade zum Beladen. */
  wegePunkte: Punkt[];
  umkreisKm: UmkreisKm;
  /** Ablagekreis um Beladen hervorheben. */
  ablageHeiss: boolean;
  /** Der Ablagekreis als Element (Mitte = Bildschirmpunkt des Beladen-Markers). */
  ablageRef: (el: HTMLDivElement | null) => void;
  onSteuerung: (s: KartenSteuerung | null) => void;
  renderPin: (g: PinGruppe) => ReactNode;
  /** Kleiner Rand auf dem Handy. */
  schmal: boolean;
}

function quelleText(p: KartenAuftragPunkt): string | null {
  if (p.quelle === "chat") return "ungefähr, aus dem Chat";
  if (p.quelle === "ort") return "Ortsmitte";
  return null;
}

export default function EinsatzKarteBild(props: EinsatzKarteBildProps) {
  const { beladen, entladen, linie, gruppen, wegePunkte, umkreisKm, ablageHeiss, ablageRef, onSteuerung, renderPin, schmal } = props;
  const { theme } = useDarstellung();
  const grau = stationsFarbe(theme);
  const karte = useRef<MapRef | null>(null);

  useEffect(() => {
    onSteuerung({
      schieben(an) {
        const m = karte.current?.getMap();
        if (!m) return;
        if (an) {
          m.dragPan.enable();
          m.touchZoomRotate.enable();
        } else {
          m.dragPan.disable();
          m.touchZoomRotate.disable();
        }
      },
    });
    return () => onSteuerung(null);
  }, [onSteuerung]);

  // Ausschnitt über Auftrag, Linie, Pins und den Umkreis (sonst liegt der Ring oft ganz außerhalb).
  const grenzen = useMemo(() => {
    const ring = beladen && umkreisKm > 0 ? kreisPunkte(beladen.punkt, umkreisKm, 16) : [];
    return kartenGrenzen({ beladen, entladen, linie: [...linie, ...ring] }, gruppen);
  }, [beladen, entladen, linie, gruppen, umkreisKm]);
  // Erster Ausschnitt einmal; Filter und Auswahl verschieben die Karte nicht, nur ein neuer Umkreis.
  const start = useRef(grenzen);
  const rand = schmal ? { top: 36, bottom: 24, left: 24, right: 60 } : { top: 60, bottom: 50, left: 50, right: 120 };
  const ersterUmkreis = useRef(umkreisKm);
  useEffect(() => {
    if (umkreisKm === ersterUmkreis.current) return;
    ersterUmkreis.current = umkreisKm;
    const m = karte.current?.getMap();
    if (m && grenzen) m.fitBounds(grenzen, { padding: rand, maxZoom: 12, duration: 400 });
    // `rand` hängt nur an `schmal`; neu einpassen nur bei neuem Umkreis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [umkreisKm, grenzen]);

  // Leere Ebenen als leere FeatureCollection (eine leere Geometrie ist kein gültiges GeoJSON).
  const strecke = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features:
        linie.length > 1
          ? [{ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: linie } }]
          : [],
    }),
    [linie],
  );
  const ring = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features:
        beladen && umkreisKm > 0
          ? [
              {
                type: "Feature" as const,
                properties: {},
                geometry: { type: "Polygon" as const, coordinates: [kreisPunkte(beladen.punkt, umkreisKm)] },
              },
            ]
          : [],
    }),
    [beladen, umkreisKm],
  );
  const wege = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: beladen
        ? wegePunkte.map((p) => ({
            type: "Feature" as const,
            properties: {},
            geometry: { type: "LineString" as const, coordinates: [p, beladen.punkt] },
          }))
        : [],
    }),
    [beladen, wegePunkte],
  );

  if (!start.current) {
    return <div className="ezk-leer">Keine Orte zum Anzeigen. Wohnorte unter Mitarbeiter eintragen.</div>;
  }
  return (
    <div className="ezk-bild-rahmen">
      <MapLibreKarte
        ref={karte}
        mapStyle={kartenStil(theme)}
        initialViewState={{ bounds: start.current, fitBoundsOptions: { padding: rand, maxZoom: 12 } }}
        dragRotate={false}
        pitchWithRotate={false}
        touchPitch={false}
        attributionControl={{ compact: true }}
        style={{ position: "absolute", inset: 0 }}
        locale={{ "Map.Title": "Karte des Einsatzes", "Marker.Title": "Kartenmarkierung" }}
      >
        <Source id="ezk-umkreis" type="geojson" data={ring}>
          <Layer id="ezk-umkreis-flaeche" type="fill" paint={{ "fill-color": BLAU, "fill-opacity": 0.05 }} />
          <Layer id="ezk-umkreis-rand" type="line" paint={{ "line-color": grau, "line-width": 1.5, "line-dasharray": [3, 3] }} />
        </Source>
        <Source id="ezk-strecke" type="geojson" data={strecke}>
          <Layer
            id="ezk-strecke-linie"
            type="line"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{ "line-color": VERMILION, "line-width": 5 }}
          />
        </Source>
        <Source id="ezk-wege" type="geojson" data={wege}>
          <Layer
            id="ezk-wege-linie"
            type="line"
            layout={{ "line-cap": "round" }}
            paint={{ "line-color": BLAU, "line-width": 2, "line-dasharray": [2, 2], "line-opacity": 0.75 }}
          />
        </Source>
        {entladen ? (
          <Marker longitude={entladen.punkt[0]} latitude={entladen.punkt[1]} anchor="center">
            <div className="ezk-auftrag" data-art="entladen">
              <i aria-hidden="true" />
              <span className="ezk-auftrag-text">
                Entladen · {entladen.text}
                {quelleText(entladen) ? <small>{quelleText(entladen)}</small> : null}
              </span>
            </div>
          </Marker>
        ) : null}
        {gruppen.map((g) => (
          <Marker key={g.schluessel} longitude={g.punkt[0]} latitude={g.punkt[1]} anchor="center">
            {renderPin(g)}
          </Marker>
        ))}
        {beladen ? (
          <Marker longitude={beladen.punkt[0]} latitude={beladen.punkt[1]} anchor="center" style={{ zIndex: 1 }}>
            <div className="ezk-auftrag" data-art="beladen">
              <div ref={ablageRef} className="ezk-ablage" data-heiss={ablageHeiss || undefined} aria-hidden="true" />
              <i aria-hidden="true" />
              <span className="ezk-auftrag-text">
                Beladen · {beladen.text}
                {quelleText(beladen) ? <small>{quelleText(beladen)}</small> : null}
              </span>
            </div>
          </Marker>
        ) : null}
      </MapLibreKarte>
    </div>
  );
}

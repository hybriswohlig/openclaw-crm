"use client";
/**
 * Fahrt-Karte im Routen-Popup (Plan 15, Bauteil 12): je Strecke eine Linie in
 * eigener Farbe, geschätzte Strecken gestrichelt als Gerade. Die gewählte Strecke
 * ist breit und deckend, die übrigen blass. Nur im Browser (next/dynamic ohne SSR).
 * Kartenstil folgt der Darstellung (Plan 14b: hell positron, dunkel dark).
 */
import { setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Layer, Map as MapLibreKarte, Source } from "@vis.gl/react-maplibre";
import { useMemo } from "react";
import { useDarstellung } from "@/components/neu/darstellung";
import { kartenStil } from "./karten-stil";
import { grenzenAus } from "./route-karte-bild-logik";
import type { FahrtLinie } from "./fahrt-karte-logik";

setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());

export default function FahrtKarteBild({ linien, aktiv }: { linien: FahrtLinie[]; aktiv: string | null }) {
  const { theme } = useDarstellung();
  const geojson = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: linien.map((l) => ({
        type: "Feature" as const,
        properties: { key: l.key, farbe: l.farbe, gestrichelt: l.gestrichelt, aktiv: aktiv === null || aktiv === l.key },
        geometry: { type: "LineString" as const, coordinates: l.punkte },
      })),
    }),
    [linien, aktiv]
  );
  const grenzen = useMemo(() => grenzenAus(linien.map((l) => l.punkte)), [linien]);
  if (!grenzen) return <div className="kalk-karte-leer">Keine Strecke zum Anzeigen.</div>;
  const breite: unknown = ["case", ["get", "aktiv"], 5, 3];
  const deckung: unknown = ["case", ["get", "aktiv"], 1, 0.3];
  return (
    <MapLibreKarte
      mapStyle={kartenStil(theme)}
      initialViewState={{ bounds: grenzen, fitBoundsOptions: { padding: 32 } }}
      interactive={false}
      attributionControl={{ compact: true }}
      style={{ position: "absolute", inset: 0 }}
      locale={{ "Map.Title": "Karte der Fahrt", "Marker.Title": "Kartenmarkierung" }}
    >
      <Source id="kalk-fahrt" type="geojson" data={geojson}>
        <Layer
          id="kalk-fahrt-echt"
          type="line"
          filter={["==", ["get", "gestrichelt"], false]}
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{ "line-color": ["get", "farbe"], "line-width": breite, "line-opacity": deckung } as never}
        />
        <Layer
          id="kalk-fahrt-geschaetzt"
          type="line"
          filter={["==", ["get", "gestrichelt"], true]}
          layout={{ "line-cap": "round" }}
          paint={{ "line-color": ["get", "farbe"], "line-width": breite, "line-opacity": deckung, "line-dasharray": [1.5, 2] } as never}
        />
      </Source>
    </MapLibreKarte>
  );
}

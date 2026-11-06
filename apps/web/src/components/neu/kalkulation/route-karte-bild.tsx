"use client";
/**
 * Die Routenkarte selbst (MapLibre, OpenFreeMap „positron“): Hauptstrecke
 * Beladen → Entladen in Vermilion 5 px, Stationswege gestrichelt in --ink-2
 * 3 px, Marker als weiße Kapseln. Nur im Browser, darum lädt `route-karte.tsx`
 * diese Datei per next/dynamic ohne SSR.
 */
import { setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Layer, Map as MapLibreKarte, Marker, Source } from "@vis.gl/react-maplibre";
import { useMemo } from "react";
import type { Teilstrecke } from "./route-karte";

setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());

const STIL = "https://tiles.openfreemap.org/styles/positron";
const VERMILION = "#f04a28";
const INK = "#222224";
const INK_2 = "#66666a";

/** Google-Polyline (Präzision 5) → [lng, lat][] */
export function polylineDekodieren(text: string): [number, number][] {
  const punkte: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < text.length) {
    for (const achse of ["lat", "lng"] as const) {
      let ergebnis = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = text.charCodeAt(index++) - 63;
        ergebnis |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index <= text.length);
      const delta = ergebnis & 1 ? ~(ergebnis >> 1) : ergebnis >> 1;
      if (achse === "lat") lat += delta;
      else lng += delta;
    }
    punkte.push([lng / 1e5, lat / 1e5]);
  }
  return punkte;
}

/** Grenzen aller Punkte als [[west, süd], [ost, nord]], null ohne Punkte. */
export function grenzenAus(linien: [number, number][][]): [[number, number], [number, number]] | null {
  let west = Infinity;
  let sued = Infinity;
  let ost = -Infinity;
  let nord = -Infinity;
  for (const linie of linien) {
    for (const [lng, lat] of linie) {
      if (lng < west) west = lng;
      if (lng > ost) ost = lng;
      if (lat < sued) sued = lat;
      if (lat > nord) nord = lat;
    }
  }
  if (!Number.isFinite(west)) return null;
  return [
    [west, sued],
    [ost, nord],
  ];
}

interface MarkerPunkt {
  label: string;
  lng: number;
  lat: number;
  fuellung: string;
  ring: string;
}

/** Marker aus den Teilstrecken: Anfang der ersten, Ende jeder Teilstrecke (ohne Doppelte). */
function markerAus(strecken: { teil: Teilstrecke; punkte: [number, number][] }[]): MarkerPunkt[] {
  const liste: MarkerPunkt[] = [];
  const stil = (name: string): Pick<MarkerPunkt, "fuellung" | "ring"> => {
    if (name === "Beladen") return { fuellung: "#ffffff", ring: VERMILION };
    if (name === "Entladen") return { fuellung: VERMILION, ring: "#ffffff" };
    return { fuellung: INK, ring: INK };
  };
  const setze = (label: string, p: [number, number] | undefined) => {
    if (!p || liste.some((m) => m.label === label)) return;
    liste.push({ label, lng: p[0], lat: p[1], ...stil(label) });
  };
  const erste = strecken[0];
  if (erste) setze(erste.teil.von, erste.punkte[0]);
  for (const s of strecken) setze(s.teil.nach, s.punkte[s.punkte.length - 1]);
  return liste;
}

export default function RouteKarteBild({ teilstrecken }: { teilstrecken: Teilstrecke[] }) {
  const strecken = useMemo(
    () => teilstrecken.map((teil) => ({ teil, punkte: polylineDekodieren(teil.polyline) })).filter((s) => s.punkte.length > 1),
    [teilstrecken]
  );
  const geojson = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: strecken.map((s) => ({
        type: "Feature" as const,
        properties: { haupt: s.teil.haupt },
        geometry: { type: "LineString" as const, coordinates: s.punkte },
      })),
    }),
    [strecken]
  );
  const grenzen = useMemo(() => grenzenAus(strecken.map((s) => s.punkte)), [strecken]);
  const marker = useMemo(() => markerAus(strecken), [strecken]);

  if (!grenzen) return <div className="kalk-karte-leer">Keine Strecke zum Anzeigen.</div>;

  return (
    <MapLibreKarte
      mapStyle={STIL}
      initialViewState={{ bounds: grenzen, fitBoundsOptions: { padding: { top: 28, bottom: 20, left: 20, right: 130 } } }}
      interactive={false}
      attributionControl={{ compact: true }}
      style={{ position: "absolute", inset: 0 }}
      locale={{ "Map.Title": "Karte der Route", "Marker.Title": "Kartenmarkierung" }}
    >
      <Source id="kalk-route" type="geojson" data={geojson}>
        <Layer
          id="kalk-route-station"
          type="line"
          filter={["==", ["get", "haupt"], false]}
          layout={{ "line-cap": "round" }}
          paint={{ "line-color": INK_2, "line-width": 3, "line-dasharray": [1.5, 2] }}
        />
        <Layer
          id="kalk-route-haupt"
          type="line"
          filter={["==", ["get", "haupt"], true]}
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{ "line-color": VERMILION, "line-width": 5 }}
        />
      </Source>
      {marker.map((m) => (
        <Marker key={m.label} longitude={m.lng} latitude={m.lat} anchor="left" offset={[10, 0]}>
          <div className="kalk-mk">
            <i style={{ background: m.fuellung, boxShadow: `0 0 0 2px ${m.ring}` }} aria-hidden="true" />
            {m.label}
          </div>
        </Marker>
      ))}
    </MapLibreKarte>
  );
}

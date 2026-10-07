/**
 * Lagekarte, Spielbrett: Inline-Stil und Ebenen. Keine externen URLs außer den
 * eigenen Glyphen unter /map/fonts. Farben aus farben.ts (MapLibre liest keine
 * CSS-Variablen). Ein Themawechsel ändert nur Paint-Werte; react-maplibre
 * überträgt sie per setPaintProperty, die Karte bleibt bestehen.
 */
import type { LayerProps } from "@vis.gl/react-maplibre";
import type { ExpressionSpecification, StyleSpecification } from "maplibre-gl";
import { BRETT_FARBEN, STATUS_STIL, WARTET_FARBE, type Thema } from "@/lib/lagekarte/farben";
import { KREIS_BASIS_M, KREIS_STUFE_M, KREIS_STUFEN_MAX } from "./geojson";
import type { Ansicht } from "./kamera";

export const HINTERGRUND_EBENE = "hintergrund";
const SCHRIFT = ["Noto Sans Medium"];

export const CLUSTER_RADIUS = 44;
export const CLUSTER_MAX_ZOOM = 11;
/** Anzahl wartender Leads je Cluster (für den roten Punkt). */
export const CLUSTER_EIGENSCHAFTEN = {
  wartet: ["+", ["case", ["get", "wartet"], 1, 0]],
} as const satisfies Record<string, unknown>;

/** Ebenen, auf die Klick und Hover reagieren (Cluster, Leads, Aufträge, Säulen). */
export const INTERAKTIVE_EBENEN = [
  "cluster-kreis",
  "lead-wartet-ring",
  "lead-icons",
  "auftrag-wartet-ring",
  "auftrag-icons",
  "saeulen-3d",
];

export function basisStil(thema: Thema): StyleSpecification {
  return {
    version: 8,
    glyphs: "/map/fonts/{fontstack}/{range}.pbf",
    sources: {},
    layers: [{ id: HINTERGRUND_EBENE, type: "background", paint: { "background-color": BRETT_FARBEN[thema].hintergrund } }],
  };
}

const AKTIVITAET: ExpressionSpecification = ["coalesce", ["feature-state", "aktivitaet"], 0];
const IST_CLUSTER: ExpressionSpecification = ["has", "point_count"];
const KEIN_CLUSTER: ExpressionSpecification = ["!", ["has", "point_count"]];
const WARTET: ExpressionSpecification = ["==", ["get", "wartet"], true];
/** Unbekannter Wert (null) zählt für die Größe wie 0, bleibt in den Daten aber null. */
const WERT: ExpressionSpecification = ["coalesce", ["get", "wertCent"], 0];

type Ebene = LayerProps & { id: string };

/** Alle Ebenen in Zeichenreihenfolge, gruppiert nach Quelle (Quelle setzt <Source>). */
export function ebenen(thema: Thema, ansicht: Ansicht) {
  const f = BRETT_FARBEN[thema];
  const wartet = WARTET_FARBE[thema];
  const auftrag = STATUS_STIL.auftrag.farbe[thema];
  const in2d = ansicht === "2d" ? "visible" : "none";
  const in3d = ansicht === "3d" ? "visible" : "none";
  const kreisFarbe: ExpressionSpecification = ["case", [">", AKTIVITAET, 0], f.kreisAktiv, f.kreis];

  return {
    kreise: [
      {
        // Plättchen-Kante: die Fläche 6 px nach unten versetzt in Kantenfarbe (nur 2D).
        id: "kreise-schatten",
        type: "fill",
        layout: { visibility: in2d },
        paint: { "fill-color": f.kreisKante, "fill-translate": [0, 6], "fill-translate-anchor": "viewport" },
      },
      {
        id: "kreise-flaeche",
        type: "fill",
        layout: { visibility: in2d },
        paint: { "fill-color": kreisFarbe },
      },
      {
        id: "kreise-3d",
        type: "fill-extrusion",
        layout: { visibility: in3d },
        paint: {
          "fill-extrusion-color": kreisFarbe,
          "fill-extrusion-height": ["+", KREIS_BASIS_M, ["*", KREIS_STUFE_M, ["min", AKTIVITAET, KREIS_STUFEN_MAX]]],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.95,
        },
      },
      {
        id: "kreise-linie",
        type: "line",
        layout: { "line-join": "round" },
        paint: {
          "line-color": f.kreisLinie,
          "line-width": ["interpolate", ["linear"], ["zoom"], 6.5, 0.6, 10, 1.3],
        },
      },
    ] satisfies Ebene[],
    land: [
      {
        id: "land-linie",
        type: "line",
        layout: { "line-join": "round" },
        paint: { "line-color": f.landLinie, "line-width": 2 },
      },
    ] satisfies Ebene[],
    kreisPunkte: [
      {
        id: "kreis-namen",
        type: "symbol",
        minzoom: 7.2,
        layout: {
          "text-field": ["get", "name"],
          "text-font": SCHRIFT,
          "text-size": 11,
          "text-transform": "none",
          "text-letter-spacing": 0.04,
          "text-max-width": 8,
          "text-padding": 4,
        },
        paint: {
          "text-color": f.beschriftung,
          "text-halo-color": f.beschriftungHalo,
          "text-halo-width": 1.4,
          "text-halo-blur": 0.2,
        },
      },
    ] satisfies Ebene[],
    auswahl: [
      {
        id: "auswahl-linie",
        type: "line",
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: { "line-color": f.auswahl, "line-width": 2, "line-opacity": 0.85, "line-dasharray": [2.5, 2] },
      },
      {
        id: "auswahl-ziel",
        type: "circle",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 4.5,
          "circle-color": f.markerHalo,
          "circle-stroke-color": f.auswahl,
          "circle-stroke-width": 2,
          "circle-pitch-alignment": "viewport",
        },
      },
    ] satisfies Ebene[],
    leads: [
      {
        id: "cluster-kreis",
        type: "circle",
        filter: IST_CLUSTER,
        paint: {
          "circle-color": f.clusterFuellung,
          "circle-opacity": 0.94,
          "circle-radius": ["step", ["get", "point_count"], 14, 10, 16, 25, 19, 50, 22],
          "circle-stroke-color": f.markerHalo,
          "circle-stroke-width": 2,
          "circle-pitch-alignment": "viewport",
        },
      },
      {
        id: "cluster-zahl",
        type: "symbol",
        filter: IST_CLUSTER,
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": SCHRIFT,
          "text-size": 12,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: { "text-color": f.clusterText },
      },
      {
        // Kleiner zinnoberroter Punkt oben rechts am Cluster, wenn darin jemand wartet.
        id: "cluster-wartet",
        type: "circle",
        filter: ["all", IST_CLUSTER, [">", ["get", "wartet"], 0]],
        paint: {
          "circle-radius": 4.5,
          "circle-color": wartet,
          "circle-stroke-color": f.markerHalo,
          "circle-stroke-width": 1.5,
          "circle-translate": [11, -11],
          "circle-translate-anchor": "viewport",
          "circle-pitch-alignment": "viewport",
        },
      },
      {
        id: "lead-wartet-ring",
        type: "circle",
        filter: ["all", KEIN_CLUSTER, WARTET],
        paint: {
          "circle-radius": 13,
          "circle-color": "rgba(0, 0, 0, 0)",
          "circle-stroke-color": wartet,
          "circle-stroke-width": 2.5,
          "circle-pitch-alignment": "viewport",
        },
      },
      {
        id: "lead-icons",
        type: "symbol",
        filter: KEIN_CLUSTER,
        layout: {
          "icon-image": ["get", "icon"],
          "icon-allow-overlap": true,
          // Wartende oben (höherer Schlüssel wird später gezeichnet).
          "symbol-sort-key": ["case", WARTET, 1, 0],
        },
      },
    ] satisfies Ebene[],
    auftraege: [
      {
        // Aufträge stehen nie im Cluster; auch wartende Aufträge bekommen den Ring.
        id: "auftrag-wartet-ring",
        type: "circle",
        filter: WARTET,
        paint: {
          "circle-radius": ["interpolate", ["linear"], WERT, 0, 14, 500000, 18],
          "circle-color": "rgba(0, 0, 0, 0)",
          "circle-stroke-color": wartet,
          "circle-stroke-width": 2.5,
          "circle-pitch-alignment": "viewport",
        },
      },
      {
        id: "auftrag-icons",
        type: "symbol",
        layout: {
          "icon-image": ["get", "icon"],
          "icon-size": ["interpolate", ["linear"], WERT, 0, 0.9, 500000, 1.35],
          "icon-allow-overlap": true,
          "symbol-sort-key": WERT,
        },
      },
    ] satisfies Ebene[],
    saeulen: [
      {
        id: "saeulen-3d",
        type: "fill-extrusion",
        layout: { visibility: in3d },
        paint: {
          "fill-extrusion-color": auftrag,
          "fill-extrusion-base": ["get", "basisM"],
          "fill-extrusion-height": ["+", ["get", "basisM"], ["get", "hoeheM"]],
          "fill-extrusion-opacity": 0.9,
        },
      },
    ] satisfies Ebene[],
  };
}

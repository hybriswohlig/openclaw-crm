"use client";
/**
 * Lagekarte: das Spielbrett. Baden-Württemberg aus 44 Kreisplättchen (eigene
 * GeoJSON-Dateien, keine Kacheln, keine Drittanbieter), Leads als Spielfiguren
 * (geclustert), Aufträge als größere Sechsecke (nie geclustert), in 3D als
 * Säulen. Client-only: der Container lädt diese Datei per next/dynamic ohne SSR.
 *
 * Die Karte ist nicht der einzige Zugang zu den Leads: dieselben Leads stehen
 * in der Liste der linken Leiste.
 */
import { setWorkerUrl, type GeoJSONSource, type MapGeoJSONFeature, type Map as MaplibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  Layer,
  Map as MapLibreKarte,
  Marker,
  Source,
  type ErrorEvent as KartenFehlerEvent,
  type MapEvent,
  type MapLayerMouseEvent,
  type MapRef,
  type MapSourceDataEvent,
  type MapStyleDataEvent,
  type ViewStateChangeEvent,
} from "@vis.gl/react-maplibre";
import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Clock, X } from "lucide-react";
import { StatusForm } from "@/components/lagekarte/status-form";
import { BRETT_FARBEN, STATUS_STIL, WARTET_LABEL, type Thema } from "@/lib/lagekarte/farben";
import type { Firma, KartenOrt, LeadPunkt } from "@/lib/lagekarte/typen";
import { warteText } from "@/lib/lagekarte/warte-text";
import { auftraegeZuGeoJson, auftragsSaeulen, auswahlLinie, auswahlZuGeoJson, kreisAktivitaet, leadsZuGeoJson } from "./geojson";
import { registriereIcons } from "./icons";
import {
  fahreKamera,
  INTRO_FAHRT_MS,
  INTRO_SCHLUESSEL,
  INTRO_VERZOEGERUNG_MS,
  MAX_GRENZEN,
  MAX_ZOOM,
  MIN_ZOOM,
  setzeNeigung,
  standardVerdeckt,
  START_ANSICHT,
  startModus,
  wechsleAnsicht,
  type Ansicht,
  type KameraZiel,
  type Rand,
} from "./kamera";
import { auswahlPlatz, SCHILD_SEITE_ABSTAND_PX, type ClusterKandidat, type Hindernis, type SchildSeite } from "./schild";
import {
  basisStil,
  CLUSTER_EIGENSCHAFTEN,
  CLUSTER_MAX_ZOOM,
  CLUSTER_RADIUS,
  clusterRadiusPx,
  ebenen,
  HINTERGRUND_EBENE,
  INTERAKTIVE_EBENEN,
  SCHILD_HINDERNIS_EBENEN,
} from "./stil";
import "./brett.css";

setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());
const MAPLIB = import("maplibre-gl");

export interface SpielbrettProps {
  leads: LeadPunkt[]; // bereits gefiltert
  firmen: Firma[];
  thema: Thema;
  ansicht: "2d" | "3d";
  auswahlId: string | null;
  onWaehle: (id: string | null) => void;
  /** Kamera-Befehl; Änderung von `kamera.n` löst Fahrt aus */
  kamera: { ziel: KameraZiel; n: number };
  /**
   * Vom Layout verdeckte Kartenränder in px (HUD und Quellenzeile oben, Leiste links, offenes
   * Panel rechts, Legende bzw. Sheet unten). Alle Kamerafahrten passen in die freie Fläche.
   */
  verdeckt?: Rand;
  onBereit?: () => void;
  onFehler?: (grund: "webgl" | "sonst", meldung: string) => void;
}

/** Deutsche UI-Texte von MapLibre; Map.Title wird das aria-label der Karte. */
const LOCALE: Record<string, string> = {
  "Map.Title": "Karte Baden-Württemberg mit Leads",
  "Marker.Title": "Kartenmarkierung",
};

const KARTEN_STIL: CSSProperties = { position: "absolute", inset: 0 };
const START = { ...START_ANSICHT, pitch: 0, bearing: 0 };

/** Quellen, ohne die das Brett leer bliebe: Ladefehler hier melden. */
const BRETT_QUELLEN = new Set(["kreise", "land", "kreis-punkte"]);

/** Figuren-Radius für die Schild-Platzierung (Icons 32 px, Form ~20 px plus Firmen-Badge). */
const FIGUR_RADIUS_PX = 12;
/** Cluster: Kreis plus Rand und Wartet-Punkt oben rechts. */
const CLUSTER_RAND_PX = 6;

type AuswahlPlatz = { seite: SchildSeite; stapel: number | null };
const PLATZ_START: AuswahlPlatz = { seite: "oben", stapel: null };

/**
 * Wohin das Namensschild des gewählten Leads passt, ohne Cluster-Zahlen oder
 * andere Figuren zu verdecken, und welche Cluster-Zahl unter dem Auswahlring
 * verschwände (Bildschirm-Pixel, siehe schild.ts).
 */
function auswahlPlatzFuer(
  map: MaplibreMap,
  ort: KartenOrt,
  eigeneId: string,
  schildBreite: number,
  verdeckt: Rand,
): AuswahlPlatz {
  const p = map.project([ort.lng, ort.lat]);
  const reichweite = schildBreite + SCHILD_SEITE_ABSTAND_PX + 40;
  const layers = SCHILD_HINDERNIS_EBENEN.filter((id) => map.getLayer(id));
  let features: MapGeoJSONFeature[] = [];
  try {
    features = layers.length
      ? map.queryRenderedFeatures(
          [
            [p.x - reichweite, p.y - reichweite],
            [p.x + reichweite, p.y + reichweite],
          ],
          { layers },
        )
      : [];
  } catch {
    return PLATZ_START;
  }
  const cluster: ClusterKandidat[] = [];
  const figuren: Hindernis[] = [];
  for (const f of features) {
    if (f.geometry.type !== "Point" || f.properties?.id === eigeneId) continue;
    const q = map.project(f.geometry.coordinates as [number, number]);
    if (f.layer.id === "cluster-kreis") {
      const anzahl = Number(f.properties?.point_count) || 0;
      cluster.push({ x: q.x - p.x, y: q.y - p.y, r: clusterRadiusPx(anzahl) + CLUSTER_RAND_PX, anzahl });
    } else {
      figuren.push({ x: q.x - p.x, y: q.y - p.y, r: FIGUR_RADIUS_PX, gewicht: 1 });
    }
  }
  // Sichtbar ist nur die freie Fläche zwischen HUD, Quellenzeile, Leiste, Panel und Legende/Sheet.
  const c = map.getContainer();
  const grenze = {
    links: verdeckt.left - p.x,
    oben: verdeckt.top - p.y,
    rechts: c.clientWidth - verdeckt.right - p.x,
    unten: c.clientHeight - verdeckt.bottom - p.y,
  };
  return auswahlPlatz(cluster, figuren, schildBreite, grenze);
}

function reduzierteBewegung(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function introSchonGeflogen(): boolean {
  try {
    return window.sessionStorage.getItem(INTRO_SCHLUESSEL) === "1";
  } catch {
    return false;
  }
}

function merkeIntro(): void {
  try {
    window.sessionStorage.setItem(INTRO_SCHLUESSEL, "1");
  } catch {
    /* ohne Speicher: dann eben bei jedem Laden */
  }
}

/** Trefferfläche um den Mauszeiger (Icons ~22 px, so mindestens ~40 px). */
const TREFFER_RADIUS = 10;
const CLUSTER_LISTE_MAX = 20;

type Treffer =
  | { art: "lead"; lead: LeadPunkt }
  | { art: "cluster"; clusterId: number; anzahl: number; lngLat: [number, number] };

type Hover = { art: "lead"; lead: LeadPunkt; x: number; y: number; breite: number } | { art: "cluster" };

interface ClusterListeZustand {
  x: number;
  y: number;
  breite: number;
  hoehe: number;
  ids: string[];
  gesamt: number;
}

/** Nächstgelegene Figur unter dem Zeiger: Einzel-Marker und Cluster nach Abstand, Säulen nur als Rückfall. */
function finde(map: MaplibreMap, p: { x: number; y: number }, leadNachId: Map<string, LeadPunkt>): Treffer | null {
  const layers = INTERAKTIVE_EBENEN.filter((id) => map.getLayer(id));
  if (layers.length === 0) return null;
  let features: MapGeoJSONFeature[];
  try {
    features = map.queryRenderedFeatures(
      [
        [p.x - TREFFER_RADIUS, p.y - TREFFER_RADIUS],
        [p.x + TREFFER_RADIUS, p.y + TREFFER_RADIUS],
      ],
      { layers },
    );
  } catch {
    return null;
  }
  let bester: Treffer | null = null;
  let besterAbstand = Infinity;
  let saeule: Treffer | null = null;
  const abstand = (lngLat: [number, number]) => {
    const q = map.project(lngLat);
    return Math.hypot(q.x - p.x, q.y - p.y);
  };
  for (const f of features) {
    if (f.layer.id === "cluster-kreis") {
      if (f.geometry.type !== "Point") continue;
      const lngLat = f.geometry.coordinates as [number, number];
      const d = abstand(lngLat);
      if (d < besterAbstand) {
        besterAbstand = d;
        bester = {
          art: "cluster",
          clusterId: Number(f.properties?.cluster_id),
          anzahl: Number(f.properties?.point_count) || 0,
          lngLat,
        };
      }
      continue;
    }
    const id = f.properties?.id;
    const lead = typeof id === "string" ? leadNachId.get(id) : undefined;
    if (!lead) continue;
    if (f.layer.id === "saeulen-3d") {
      saeule ??= { art: "lead", lead };
      continue;
    }
    if (!lead.ort) continue;
    const d = abstand([lead.ort.lng, lead.ort.lat]);
    if (d < besterAbstand) {
      besterAbstand = d;
      bester = { art: "lead", lead };
    }
  }
  return bester ?? saeule;
}

function ortText(o: KartenOrt): string {
  const text = [o.plz, o.ortsname].filter(Boolean).join(" ");
  return o.quelle === "zieladresse" ? `${text} (Zieladresse)` : text;
}

const FOKUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lk-akzent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--lk-panel)]";

function Tooltip({ lead, x, y, breite, thema }: { lead: LeadPunkt; x: number; y: number; breite: number; thema: Thema }) {
  // Zu nah am oberen Rand: unter den Punkt statt darüber.
  const unten = y < 132;
  const links = Math.min(Math.max(x, 140), Math.max(140, breite - 140));
  return (
    <div
      role="tooltip"
      className="lk-glas lk-brett-ein pointer-events-none absolute z-10 w-max max-w-[260px] px-3 py-2"
      style={{
        left: links,
        top: y,
        borderRadius: 12,
        transform: unten ? "translate(-50%, 20px)" : "translate(-50%, calc(-100% - 20px))",
      }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <StatusForm status={lead.status} thema={thema} groesse={14} />
        <span className="truncate text-[13px] leading-tight font-semibold" style={{ color: "var(--lk-text)" }}>
          {lead.name}
        </span>
      </div>
      <div className="mt-1 text-[12px] leading-snug" style={{ color: "var(--lk-text-leise)" }}>
        {STATUS_STIL[lead.status].label}
        {lead.ort && <> · {ortText(lead.ort)}</>}
      </div>
      {lead.wartet && (
        <div className="mt-1 flex items-center gap-1 text-[12px] leading-snug font-medium" style={{ color: "var(--lk-wartet)" }}>
          <Clock className="size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {WARTET_LABEL[lead.wartet.art]}, {warteText(lead.wartet.seit, new Date())}
          </span>
        </div>
      )}
    </div>
  );
}

/** Kleine Liste der Mitglieder eines Clusters, der sich nicht weiter aufzoomen lässt. */
function ClusterListe({
  zustand,
  leads,
  thema,
  onWaehle,
  onSchliessen,
}: {
  zustand: ClusterListeZustand;
  leads: LeadPunkt[];
  thema: Thema;
  onWaehle: (id: string) => void;
  onSchliessen: () => void;
}) {
  const ersterRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ersterRef.current?.focus();
  }, []);
  const links = Math.max(8, Math.min(zustand.x + 14, zustand.breite - 288));
  const oben = Math.max(8, Math.min(zustand.y - 24, zustand.hoehe - 352));
  const rest = zustand.gesamt - leads.length;
  return (
    <div
      role="dialog"
      aria-label={`${zustand.gesamt} Anfragen an diesem Ort`}
      className="lk-glas lk-brett-ein absolute z-20 flex w-[272px] flex-col overflow-hidden"
      style={{ left: links, top: oben, maxHeight: Math.min(340, zustand.hoehe - 16) }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onSchliessen();
        }
      }}
    >
      <div className="flex items-center justify-between gap-2 py-1 pr-1 pl-3.5">
        <span className="k-label" style={{ color: "var(--lk-text-schwach)" }}>
          {zustand.gesamt} Anfragen hier
        </span>
        <button
          type="button"
          aria-label="Liste schließen"
          onClick={onSchliessen}
          className={`inline-flex size-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--lk-hover)] active:bg-[var(--lk-aktiv)] ${FOKUS}`}
          style={{ color: "var(--lk-text-leise)" }}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
        {leads.map((l, i) => (
          <li key={l.id}>
            <button
              type="button"
              ref={i === 0 ? ersterRef : undefined}
              onClick={() => onWaehle(l.id)}
              className={`flex min-h-11 w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left transition-colors hover:bg-[var(--lk-hover)] active:bg-[var(--lk-aktiv)] ${FOKUS}`}
            >
              <StatusForm status={l.status} thema={thema} groesse={18} wartet={l.wartet !== null} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] leading-tight font-medium" style={{ color: "var(--lk-text)" }}>
                  {l.name}
                </span>
                <span className="mt-0.5 block truncate text-[11.5px] leading-tight" style={{ color: "var(--lk-text-leise)" }}>
                  {STATUS_STIL[l.status].kurz}
                  {l.ort && <> · {ortText(l.ort)}</>}
                </span>
              </span>
              {l.wartet && (
                <Clock className="size-3.5 shrink-0" style={{ color: "var(--lk-wartet)" }} aria-label="wartet auf uns" role="img" />
              )}
            </button>
          </li>
        ))}
      </ul>
      {rest > 0 && (
        <p className="px-3.5 pb-2.5 text-[11.5px]" style={{ color: "var(--lk-text-schwach)" }}>
          und {rest} weitere, alle stehen auch in der Liste
        </p>
      )}
    </div>
  );
}

/** Fängt Render-Fehler der Karte ab (z. B. ohne WebGL), damit die Seite stehen bleibt. */
class KartenGrenze extends Component<{ onFehler: (meldung: string) => void; children: ReactNode }, { kaputt: boolean }> {
  state = { kaputt: false };
  static getDerivedStateFromError() {
    return { kaputt: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onFehler(error instanceof Error ? error.message : String(error));
  }
  render() {
    return this.state.kaputt ? null : this.props.children;
  }
}

export default function Spielbrett({
  leads,
  firmen,
  thema,
  ansicht,
  auswahlId,
  onWaehle,
  kamera,
  verdeckt,
  onBereit,
  onFehler,
}: SpielbrettProps) {
  const mapRef = useRef<MapRef>(null);
  const [geladen, setGeladen] = useState(false);
  const [defekt, setDefekt] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);
  const [liste, setListe] = useState<ClusterListeZustand | null>(null);
  const [platz, setPlatz] = useState<AuswahlPlatz>(PLATZ_START);
  const schildRef = useRef<HTMLSpanElement>(null);

  // Der Stil wird einmal gebaut; Themawechsel laufen über setPaintProperty.
  const [stil] = useState(() => basisStil(thema));

  const leadNachId = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);
  const auswahl = auswahlId ? (leadNachId.get(auswahlId) ?? null) : null;

  // Neuer Lead: Schild zuerst oben, nach der Fahrt (onIdle) an den freien Platz.
  useEffect(() => {
    setPlatz(PLATZ_START);
  }, [auswahlId]);

  // Der gewählte Lead steht nie im Cluster, sondern einzeln in der Auswahl-Quelle (eigene Ebenen obenauf).
  const auswahlIdMitOrt = auswahl?.ort ? auswahl.id : null;
  const leadsGeo = useMemo(
    () => leadsZuGeoJson(leads, thema, firmen, auswahlIdMitOrt),
    [leads, thema, firmen, auswahlIdMitOrt],
  );
  const auswahlGeo = useMemo(() => auswahlZuGeoJson(auswahl, thema, firmen), [auswahl, thema, firmen]);
  const auftraegeGeo = useMemo(() => auftraegeZuGeoJson(leads, thema, firmen), [leads, thema, firmen]);
  const saeulenGeo = useMemo(() => auftragsSaeulen(leads), [leads]);
  const linieGeo = useMemo(() => auswahlLinie(auswahl), [auswahl]);
  const aktivitaet = useMemo(() => kreisAktivitaet(leads), [leads]);
  const schichten = useMemo(() => ebenen(thema, ansicht), [thema, ansicht]);

  const geladenRef = useRef(false);
  const letzteKameraN = useRef(kamera.n);
  const letzteAnsicht = useRef<Ansicht>(ansicht);
  /**
   * Start ins Kerngebiet steht noch aus (Ruling 10): beim Aufbau ohne verortete Leads oder
   * während der kurzen Pause vor dem Flug. Bewegt jemand die Karte oder kommt ein
   * Kamera-Befehl (z. B. Flug zur Auswahl), entfällt er.
   */
  const startOffen = useRef(false);
  const startModusRef = useRef<"flug" | "direkt">("direkt");
  const introTimer = useRef<number | null>(null);
  // Für den verzögerten Flug: immer die neuesten Leads, Ansicht und Ränder.
  const verdecktJetzt = verdeckt ?? null;
  const aktuell = useRef({ leads, ansicht, verdeckt: verdecktJetzt });
  aktuell.current = { leads, ansicht, verdeckt: verdecktJetzt };
  const hoverSchluessel = useRef<string | null>(null);
  const klickNr = useRef(0);
  const iconSchluessel = useRef<string | null>(null);
  const kreiseQuelle = useRef<unknown>(null);
  const gesetzteAgs = useRef<Set<string>>(new Set());

  const karte = () => mapRef.current?.getMap() ?? null;
  const firmenSchluessel = firmen.map((f) => `${f.id}:${f.kurz}:${f.farbe}`).join("|");

  function meldeFehler(grund: "webgl" | "sonst", meldung: string) {
    if (grund === "webgl" || !geladenRef.current) setDefekt(true);
    onFehler?.(grund, meldung);
  }

  /** Aktivität je Kreis als Feature-State (Quelle „kreise“ mit promoteId „ags“). */
  function wendeAktivitaetAn(map: MaplibreMap) {
    if (!map.getSource("kreise")) return;
    for (const ags of gesetzteAgs.current) {
      if (!(ags in aktivitaet)) map.setFeatureState({ source: "kreise", id: ags }, { aktivitaet: 0 });
    }
    for (const [ags, n] of Object.entries(aktivitaet)) {
      map.setFeatureState({ source: "kreise", id: ags }, { aktivitaet: n });
    }
    gesetzteAgs.current = new Set(Object.keys(aktivitaet));
  }

  function stoppeIntro() {
    if (introTimer.current !== null) {
      window.clearTimeout(introTimer.current);
      introTimer.current = null;
    }
  }

  /** Ränder für die nächste Fahrt: gemessen vom Container, sonst Standard. */
  function randJetzt(): Rand {
    return aktuell.current.verdeckt ?? standardVerdeckt();
  }

  /**
   * Ins Kerngebiet, sobald verortete Leads da sind: „direkt“ springt, „flug“ zeigt ganz BW,
   * wartet kurz und fliegt dann (einmal je Sitzung). Erst im nächsten Task: Legende und Sheet
   * kommen mit denselben Daten und sind dann gemessen (verdeckte Ränder stimmen).
   */
  function starteKern(map: MaplibreMap) {
    startOffen.current = false;
    stoppeIntro();
    const flug = startModusRef.current === "flug";
    introTimer.current = window.setTimeout(() => {
      const { leads: jetzt, ansicht: a } = aktuell.current;
      if (!flug) {
        introTimer.current = null;
        fahreKamera(map, "kern", jetzt, null, a, randJetzt(), 0);
        return;
      }
      fahreKamera(map, "bw", jetzt, null, a, randJetzt(), 0);
      introTimer.current = window.setTimeout(() => {
        introTimer.current = null;
        merkeIntro();
        const neu = aktuell.current;
        fahreKamera(map, "kern", neu.leads, null, neu.ansicht, randJetzt(), INTRO_FAHRT_MS);
      }, INTRO_VERZOEGERUNG_MS);
    }, 0);
  }

  function beimLaden(ev: MapEvent) {
    const map = ev.target;
    try {
      registriereIcons(map, firmen);
      iconSchluessel.current = firmenSchluessel;
    } catch (err) {
      console.warn("[Lagekarte] Icons konnten nicht erzeugt werden", err);
    }
    if (ansicht === "3d") setzeNeigung(map, "3d", true);
    letzteAnsicht.current = ansicht;
    // Nur in der Entwicklung: Prüfskripte (Playwright) lesen Kamera und Projektion.
    if (process.env.NODE_ENV !== "production") (window as unknown as { __lagekarteKarte?: MaplibreMap }).__lagekarteKarte = map;
    // Ruling 10: zuerst ganz BW (mit den Layout-Rändern), dann einmal je Sitzung der Flug ins
    // Kerngebiet; bei reduzierter Bewegung oder schon geflogen gleich das Kerngebiet.
    startModusRef.current = startModus({ reduziert: reduzierteBewegung(), schonGeflogen: introSchonGeflogen() });
    fahreKamera(map, "bw", leads, null, ansicht, randJetzt(), 0);
    startOffen.current = true;
    if (leads.some((l) => l.ort)) starteKern(map);
    geladenRef.current = true;
    setGeladen(true);
    onBereit?.();
  }

  function beiFehler(ev: KartenFehlerEvent) {
    const meldung = ev.error?.message || String(ev.error ?? "Unbekannter Kartenfehler");
    const quelle = (ev as unknown as { sourceId?: string }).sourceId;
    // target fehlt nur, wenn die Karte gar nicht erst gebaut werden konnte.
    if (/webgl/i.test(meldung) || !ev.target) meldeFehler("webgl", meldung);
    else if (!geladenRef.current || (quelle && BRETT_QUELLEN.has(quelle))) meldeFehler("sonst", meldung);
    else console.warn("[Lagekarte]", meldung);
  }

  function beiQuelldaten(ev: MapSourceDataEvent | MapStyleDataEvent) {
    if (!("sourceId" in ev) || ev.sourceId !== "kreise") return;
    const map = ev.target;
    const q = map.getSource("kreise");
    // Quelle neu angelegt (z. B. StrictMode-Remount): Feature-States sind dann weg.
    if (q && q !== kreiseQuelle.current) {
      kreiseQuelle.current = q;
      wendeAktivitaetAn(map);
    }
  }

  function beiBewegungsstart(ev: ViewStateChangeEvent) {
    // Wer selbst schiebt oder zoomt, bekommt keinen Startflug mehr.
    if (ev.originalEvent) {
      startOffen.current = false;
      stoppeIntro();
    }
    hoverSchluessel.current = null;
    setHover(null);
    setListe(null);
  }

  function beiMausBewegung(ev: MapLayerMouseEvent) {
    const map = ev.target;
    const t = finde(map, ev.point, leadNachId);
    const schluessel = t ? (t.art === "lead" ? `l:${t.lead.id}` : `c:${t.clusterId}`) : null;
    if (schluessel === hoverSchluessel.current) return;
    hoverSchluessel.current = schluessel;
    if (!t) setHover(null);
    else if (t.art === "cluster") setHover({ art: "cluster" });
    else if (t.lead.ort) {
      const q = map.project([t.lead.ort.lng, t.lead.ort.lat]);
      setHover({ art: "lead", lead: t.lead, x: q.x, y: q.y, breite: map.getContainer().clientWidth });
    }
  }

  /** Nach jeder Fahrt und jedem neuen Datenstand (Cluster ändern sich): Schild und Plakette neu setzen. */
  function beiRuhe(ev: MapEvent) {
    if (!auswahl?.ort) return;
    const neu = auswahlPlatzFuer(ev.target, auswahl.ort, auswahl.id, schildRef.current?.offsetWidth ?? 160, randJetzt());
    setPlatz((alt) => (alt.seite === neu.seite && alt.stapel === neu.stapel ? alt : neu));
  }

  function beiMausRaus() {
    hoverSchluessel.current = null;
    setHover(null);
  }

  async function beiKlick(ev: MapLayerMouseEvent) {
    const map = ev.target;
    const nr = ++klickNr.current;
    setListe(null);
    const t = finde(map, ev.point, leadNachId);
    if (!t) return; // Klick ins Leere: nichts
    if (t.art === "lead") {
      onWaehle(t.lead.id);
      return;
    }
    const quelle = map.getSource<GeoJSONSource>("leads");
    if (!quelle) return;
    try {
      const zielZoom = await quelle.getClusterExpansionZoom(t.clusterId);
      if (nr !== klickNr.current) return;
      if (zielZoom >= CLUSTER_MAX_ZOOM || map.getZoom() >= CLUSTER_MAX_ZOOM) {
        const blaetter = await quelle.getClusterLeaves(t.clusterId, CLUSTER_LISTE_MAX, 0);
        if (nr !== klickNr.current) return;
        const ids = blaetter.map((f) => f.properties?.id).filter((id): id is string => typeof id === "string");
        const c = map.getContainer();
        setListe({ x: ev.point.x, y: ev.point.y, breite: c.clientWidth, hoehe: c.clientHeight, ids, gesamt: t.anzahl });
      } else {
        map.easeTo({ center: t.lngLat, zoom: zielZoom, duration: 500 });
      }
    } catch {
      // Cluster gibt es nach neuen Daten nicht mehr: nichts tun.
    }
  }

  // Firmen-Icons nachziehen, falls sich Firmen oder Farben ändern (vor dem Zeichnen der neuen Daten).
  useLayoutEffect(() => {
    const map = karte();
    if (!geladen || !map || iconSchluessel.current === firmenSchluessel) return;
    iconSchluessel.current = firmenSchluessel;
    // Wie in beimLaden: ein Fehler beim Zeichnen (alte Browser) darf nie bis zur globalen
    // Fehlerseite durchschlagen; die Karte zeigt dann nur die Grund-Icons.
    try {
      registriereIcons(map, firmen);
    } catch (err) {
      console.warn("[Lagekarte] Icons konnten nicht erzeugt werden", err);
    }
  }, [geladen, firmenSchluessel, firmen]);

  // Hintergrund ist Teil des Inline-Stils, die übrigen Ebenen aktualisiert <Layer>.
  useEffect(() => {
    const map = karte();
    if (!geladen || !map) return;
    map.setPaintProperty(HINTERGRUND_EBENE, "background-color", BRETT_FARBEN[thema].hintergrund);
  }, [geladen, thema]);

  useEffect(() => {
    const map = karte();
    if (!geladen || !map) return;
    wendeAktivitaetAn(map);
    // wendeAktivitaetAn liest nur aktivitaet und Refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geladen, aktivitaet]);

  // 2D/3D (nicht beim Aufbau, das erledigt beimLaden): 3D fährt ins Diorama, 2D wieder flach (Ruling 16).
  useEffect(() => {
    const map = karte();
    if (!geladen || !map || letzteAnsicht.current === ansicht) return;
    letzteAnsicht.current = ansicht;
    // Der Nutzer schaltet: ein noch wartender Startflug entfällt.
    startOffen.current = false;
    stoppeIntro();
    wechsleAnsicht(map, ansicht, aktuell.current.leads, randJetzt());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geladen, ansicht]);

  // Kamera-Befehle: nur eine Änderung von kamera.n löst eine Fahrt aus (der Startflug entfällt dann).
  useEffect(() => {
    const map = karte();
    if (!geladen || !map || letzteKameraN.current === kamera.n) return;
    letzteKameraN.current = kamera.n;
    startOffen.current = false;
    stoppeIntro();
    fahreKamera(map, kamera.ziel, leads, auswahl, ansicht, randJetzt());
    // bewusst nur an kamera.n gebunden
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geladen, kamera.n]);

  // Kamen die Leads erst nach dem Aufbau, den Start ins Kerngebiet einmal nachholen.
  useEffect(() => {
    const map = karte();
    if (!geladen || !map || !startOffen.current || !leads.some((l) => l.ort)) return;
    starteKern(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geladen, leads]);

  // Abbau: wartender Startflug darf nicht auf eine entfernte Karte zugreifen.
  useEffect(() => stoppeIntro, []);

  const listenLeads = useMemo(() => {
    if (!liste) return [];
    const gefunden = liste.ids.flatMap((id) => {
      const l = leadNachId.get(id);
      return l ? [l] : [];
    });
    // Wartende zuerst, sonst Reihenfolge der Quelle.
    return [...gefunden.filter((l) => l.wartet), ...gefunden.filter((l) => !l.wartet)];
  }, [liste, leadNachId]);

  const auswahlFarbe = BRETT_FARBEN[thema].auswahl;
  const auswahlStil = {
    "--lk-brett-auswahl": auswahlFarbe,
    "--lk-brett-stapel": BRETT_FARBEN[thema].clusterFuellung,
    "--lk-brett-stapel-text": BRETT_FARBEN[thema].clusterText,
    "--lk-brett-stapel-rand": BRETT_FARBEN[thema].clusterRand,
    "--lk-brett-halo": BRETT_FARBEN[thema].markerHalo,
  } as CSSProperties;

  return (
    <div className="lk-brett relative h-full w-full overflow-hidden" style={{ background: BRETT_FARBEN[thema].hintergrund }}>
      <KartenGrenze onFehler={(m) => meldeFehler(/webgl/i.test(m) || !geladenRef.current ? "webgl" : "sonst", m)}>
        <MapLibreKarte
          ref={mapRef}
          mapLib={MAPLIB}
          initialViewState={START}
          mapStyle={stil}
          style={KARTEN_STIL}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          maxBounds={MAX_GRENZEN}
          renderWorldCopies={false}
          attributionControl={false}
          maplibreLogo={false}
          locale={LOCALE}
          dragRotate={ansicht === "3d"}
          touchPitch={ansicht === "3d"}
          interactiveLayerIds={INTERAKTIVE_EBENEN}
          cursor={hover ? "pointer" : undefined}
          onLoad={beimLaden}
          onError={beiFehler}
          onSourceData={beiQuelldaten}
          onMoveStart={beiBewegungsstart}
          onMouseMove={beiMausBewegung}
          onMouseOut={beiMausRaus}
          onClick={beiKlick}
          onIdle={beiRuhe}
        >
          {geladen && (
            <>
              <Source id="kreise" type="geojson" data="/geo/bw-kreise.geojson" promoteId="ags">
                {schichten.kreise.map((l) => (
                  <Layer key={l.id} {...l} />
                ))}
              </Source>
              <Source id="land" type="geojson" data="/geo/bw-land.geojson">
                {schichten.land.map((l) => (
                  <Layer key={l.id} {...l} />
                ))}
              </Source>
              <Source id="auswahl-linie" type="geojson" data={linieGeo}>
                {schichten.auswahl.map((l) => (
                  <Layer key={l.id} {...l} />
                ))}
              </Source>
              <Source
                id="leads"
                type="geojson"
                data={leadsGeo}
                cluster
                clusterRadius={CLUSTER_RADIUS}
                clusterMaxZoom={CLUSTER_MAX_ZOOM}
                clusterProperties={CLUSTER_EIGENSCHAFTEN}
              >
                {schichten.leads.map((l) => (
                  <Layer key={l.id} {...l} />
                ))}
              </Source>
              <Source id="auftraege" type="geojson" data={auftraegeGeo}>
                {schichten.auftraege.map((l) => (
                  <Layer key={l.id} {...l} />
                ))}
              </Source>
              <Source id="saeulen" type="geojson" data={saeulenGeo}>
                {schichten.saeulen.map((l) => (
                  <Layer key={l.id} {...l} />
                ))}
              </Source>
              {/* Kreisnamen über den Figuren (Platzierung vor Icons, siehe stil.ts), darüber die
                  unsichtbare Cluster-Sperre (wird vor den Namen platziert). */}
              <Source id="kreis-punkte" type="geojson" data="/geo/bw-kreise-punkte.geojson">
                {schichten.kreisPunkte.map((l) => (
                  <Layer key={l.id} {...l} />
                ))}
              </Source>
              {schichten.clusterSperre.map((l) => (
                <Layer key={l.id} {...l} />
              ))}
              {/* Zuletzt: der gewählte Lead liegt über allen Figuren und Clustern. */}
              <Source id="auswahl-lead" type="geojson" data={auswahlGeo}>
                {schichten.auswahlLead.map((l) => (
                  <Layer key={l.id} {...l} />
                ))}
              </Source>
            </>
          )}
          {auswahl?.ort && (
            <Marker
              key={auswahl.id}
              longitude={auswahl.ort.lng}
              latitude={auswahl.ort.lat}
              anchor="center"
              style={{ pointerEvents: "none", zIndex: 3 }}
            >
              <div className="lk-brett-auswahl" data-seite={platz.seite} style={auswahlStil} aria-hidden="true">
                <span className="lk-brett-auswahl__puls lk-puls" />
                <span className="lk-brett-auswahl__ring" />
                {/* Zahl des Clusters, den Ring und Figur verdecken (gleiche Leads wie dort). */}
                {platz.stapel !== null && <span className="lk-brett-auswahl__stapel">{platz.stapel}</span>}
                <span ref={schildRef} className="lk-brett-auswahl__schild">
                  {auswahl.name}
                </span>
              </div>
            </Marker>
          )}
          {/* Quellenvermerk: immer sichtbar als eigene Zeile unter dem HUD (quellenangabe.tsx). */}
        </MapLibreKarte>
      </KartenGrenze>

      {hover?.art === "lead" && <Tooltip lead={hover.lead} x={hover.x} y={hover.y} breite={hover.breite} thema={thema} />}

      {liste && (
        <ClusterListe
          zustand={liste}
          leads={listenLeads}
          thema={thema}
          onWaehle={(id) => {
            setListe(null);
            onWaehle(id);
          }}
          onSchliessen={() => {
            setListe(null);
            karte()?.getCanvas().focus();
          }}
        />
      )}

      {defekt && (
        <p
          role="status"
          className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-6 text-center text-[13px]"
          style={{ color: "var(--lk-text-leise)" }}
        >
          Die Karte kann auf diesem Gerät nicht angezeigt werden. Alle Anfragen stehen in der Liste.
        </p>
      )}
    </div>
  );
}

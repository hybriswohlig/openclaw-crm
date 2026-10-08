"use client";
/**
 * Lagekarte: Container der Startseite. Lädt die Lage (Polling), hält Filter
 * und Auswahl in der URL und setzt Spielbrett, HUD, Leiste, Legende und
 * Lead-Panel zusammen. Client-only (die Seite lädt diese Datei per
 * next/dynamic ohne SSR, das Spielbrett braucht window und WebGL2).
 *
 * Tastatur: die Leiste besitzt „/“, „j“, „k“, das Panel „Esc“; hier nur „3“
 * (2D/3D umschalten).
 */
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useTheme } from "next-themes";
import { AlertTriangle, LayoutList, RotateCw } from "lucide-react";
import type { Thema } from "@/lib/lagekarte/farben";
import type { Firma, LeadPunkt } from "@/lib/lagekarte/typen";
import Spielbrett from "./brett/spielbrett";
import type { KameraZiel, Rand } from "./brett/kamera";
import { behalteAuswahl, FIRMA_OHNE, filtereLeads, zaehleStatus, type KartenFilter } from "./filter";
import Hud from "./hud";
import Ladebild, { BrettSilhouette } from "./ladebild";
import Leiste, { type LeistenTab } from "./leiste";
import Legende from "./legende";
import LeadPanel, { type PanelTab } from "./panel/lead-panel";
import { ThemaKontext } from "./thema";
import { useKartenFilter } from "./use-karten-filter";
import { useLagekarteDaten } from "./use-lagekarte-daten";
import "./lagekarte.css";

export interface LagekarteProps {
  /** Zur klassischen Startseite wechseln (HUD „Liste“, WebGL-Hinweis). */
  onListe: () => void;
}

type Ansicht = "2d" | "3d";

const ANSICHT_SCHLUESSEL = "kottke:lagekarte-ansicht";
const MOBIL_ABFRAGE = "(max-width: 1023.98px)";
/**
 * Mobiles Sheet: Peek-Höhe in px, aufgeklappt 72vh, aber nie unter das HUD
 * (sonst deckt das HUD den oberen Teil des Griffs ab; siehe sheetOffenHoehe).
 * 184 statt 168: Griff und Tabs haben 44-px-Trefferflächen, darunter bleibt
 * wie vorher die Überschrift der Liste als Hinweis sichtbar.
 */
const SHEET_PEEK_PX = 184;
/** Desktop: Leiste links (12 + 340 + 12), Panel rechts (12 + 400 + 12). */
const LEISTE_RAUM_PX = 364;
const PANEL_RAUM_PX = 424;
/** Abstand der Leiste und des Panels unter dem HUD (HUD-Höhe wird gemessen). */
const HUD_OBEN_PX = 12;
const HUD_ABSTAND_PX = 8;
const SUCHE_VERZOEGERUNG_MS = 250;

const KEINE_LEADS: LeadPunkt[] = [];
const KEINE_FIRMEN: Firma[] = [];

function leseAnsicht(): Ansicht {
  try {
    return window.localStorage.getItem(ANSICHT_SCHLUESSEL) === "3d" ? "3d" : "2d";
  } catch {
    return "2d";
  }
}

function speichereAnsicht(a: Ansicht) {
  try {
    window.localStorage.setItem(ANSICHT_SCHLUESSEL, a);
  } catch {
    /* privater Modus o. Ä.: nur für diese Sitzung */
  }
}

/** MapLibre 6 braucht WebGL2. Vorab prüfen, statt erst am Kartenfehler zu scheitern. */
function hatWebgl2(): boolean {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function istEingabeAktiv(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return el.getAttribute("role") === "textbox";
}

/** Wartende sehen zuerst den Chat, Angebote und Aufträge das Angebot. */
function startTabFuer(lead: LeadPunkt): PanelTab {
  if (lead.wartet) return "chat";
  if (lead.status === "auftrag" || lead.status === "angebot") return "angebot";
  return "chat";
}

/**
 * Höhe eines Elements in px (0 ohne Element). Erste Messung im Layout-Effekt, also vor dem
 * Zeichnen; danach per ResizeObserver. Kamerafahrten lesen sie (verdeckte Ränder).
 */
function useHoehe(): [(el: HTMLElement | null) => void, number] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [hoehe, setHoehe] = useState(0);
  useLayoutEffect(() => {
    if (!el) {
      setHoehe(0);
      return;
    }
    const messen = () => setHoehe(Math.round(el.getBoundingClientRect().height));
    messen();
    const beobachter = new ResizeObserver(messen);
    beobachter.observe(el);
    return () => beobachter.disconnect();
  }, [el]);
  return [setEl, hoehe];
}

/** Mobiles Lead-Panel: 82vh, aber nie höher als der Container minus 8 px (wie seine CSS-Klasse). */
function mobilPanelHoehe(containerHoehe: number): number {
  return Math.max(0, Math.min(window.innerHeight * 0.82, containerHoehe - 8));
}

function useMedienAbfrage(abfrage: string): boolean {
  const abonnieren = useCallback(
    (melden: () => void) => {
      const mql = window.matchMedia(abfrage);
      mql.addEventListener("change", melden);
      return () => mql.removeEventListener("change", melden);
    },
    [abfrage],
  );
  return useSyncExternalStore(
    abonnieren,
    () => window.matchMedia(abfrage).matches,
    () => false,
  );
}

export default function Lagekarte(props: LagekarteProps) {
  // useKartenFilter liest useSearchParams: ohne Suspense-Grenze bricht Next 15 das Rendern ab.
  return (
    <Suspense fallback={<Ladebild />}>
      <LagekarteInhalt {...props} />
    </Suspense>
  );
}

function LagekarteInhalt({ onListe }: LagekarteProps) {
  const { resolvedTheme } = useTheme();
  const thema: Thema = resolvedTheme === "dark" ? "dunkel" : "hell";
  const mobil = useMedienAbfrage(MOBIL_ABFRAGE);

  const { daten, fehler, neuLaden } = useLagekarteDaten();
  const { filter: urlFilter, setzeFilter, zuruecksetzen, auswahlId, waehle } = useKartenFilter();

  /* ── Suche: sofort lokal, entprellt in die URL (sonst springt der Cursor beim Tippen) ── */
  const [suche, setSuche] = useState(urlFilter.suche);
  const geschriebeneSuche = useRef(urlFilter.suche);
  useEffect(() => {
    // Von außen geändert (Zurücksetzen, Zurück-Taste): übernehmen.
    if (urlFilter.suche !== geschriebeneSuche.current) {
      geschriebeneSuche.current = urlFilter.suche;
      setSuche(urlFilter.suche);
    }
  }, [urlFilter.suche]);
  useEffect(() => {
    if (suche.trim() === geschriebeneSuche.current) return;
    const t = setTimeout(() => {
      geschriebeneSuche.current = suche.trim();
      setzeFilter({ suche });
    }, SUCHE_VERZOEGERUNG_MS);
    return () => clearTimeout(t);
  }, [suche, setzeFilter]);

  const filterSchluessel = `${JSON.stringify(urlFilter)}\u0000${suche}`;
  // Nur bei inhaltlicher Änderung ein neues Objekt (z. B. nicht bei Auswahlwechsel in der URL),
  // damit das Spielbrett nicht bei jedem Klick neue Daten setzt.
  const filter = useMemo<KartenFilter>(
    () => ({ ...urlFilter, suche }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterSchluessel],
  );

  const zuruecksetzenAlles = useCallback(() => {
    geschriebeneSuche.current = "";
    setSuche("");
    zuruecksetzen();
  }, [zuruecksetzen]);

  /* ── Abgeleitete Daten ── */
  const alle = daten?.leads ?? KEINE_LEADS;
  const firmen = daten?.firmen ?? KEINE_FIRMEN;
  // Ein „Jetzt“ je Datenstand: Zeitfilter und Wartezeiten springen nur mit neuen Daten.
  const jetzt = useMemo(() => new Date(), [daten]);
  const leadsGefiltert = useMemo(() => filtereLeads(alle, filter, jetzt), [alle, filter, jetzt]);
  const statusZahlen = useMemo(() => zaehleStatus(alle, filter, jetzt), [alle, filter, jetzt]);
  const firmenZahlen = useMemo(() => {
    const zahlen: Record<string, number> = {};
    for (const l of filtereLeads(alle, { ...filter, firmen: [] }, jetzt)) {
      const schluessel = l.firmaId ?? FIRMA_OHNE;
      zahlen[schluessel] = (zahlen[schluessel] ?? 0) + 1;
    }
    return zahlen;
  }, [alle, filter, jetzt]);
  const trefferMitOrt = useMemo(() => leadsGefiltert.filter((l) => l.ort !== null).length, [leadsGefiltert]);

  // Auswahl aus der UNGEFILTERTEN Liste: Polling und Filter schließen das Panel nie.
  const { lead: auswahl, imFilter } = behalteAuswahl(auswahlId, alle, leadsGefiltert);
  const auswahlLeadId = auswahl?.id ?? null;
  // Start-Tab nur beim Wechsel des Leads festlegen; ein Poll, der „wartet“ ändert, springt nicht um.
  const startTab = useMemo<PanelTab>(
    () => (auswahl ? startTabFuer(auswahl) : "chat"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auswahlLeadId],
  );

  /* ── 2D/3D (pro Gerät gemerkt), Taste „3“ ── */
  const [ansicht, setAnsichtZustand] = useState<Ansicht>(leseAnsicht);
  const ansichtRef = useRef(ansicht);
  ansichtRef.current = ansicht;
  const setzeAnsicht = useCallback((a: Ansicht) => {
    setAnsichtZustand(a);
    speichereAnsicht(a);
  }, []);
  useEffect(() => {
    function beiTaste(e: KeyboardEvent) {
      if (e.key !== "3" || e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      if (istEingabeAktiv()) return;
      e.preventDefault();
      setzeAnsicht(ansichtRef.current === "3d" ? "2d" : "3d");
    }
    document.addEventListener("keydown", beiTaste);
    return () => document.removeEventListener("keydown", beiTaste);
  }, [setzeAnsicht]);

  /* ── Kamera: erster „kern“ macht das Spielbrett selbst; Befehle zählen hoch ── */
  const [kamera, setKamera] = useState<{ ziel: KameraZiel; n: number }>({ ziel: "kern", n: 0 });
  const fahre = useCallback((ziel: KameraZiel) => setKamera((k) => ({ ziel, n: k.n + 1 })), []);
  // Flug zur Auswahl erst, wenn die Auswahl wirklich in den Props steht (URL-Update ist asynchron),
  // und je Lead nur einmal (Polling liefert neue Objekte mit gleicher ID).
  const geflogenFuer = useRef<string | null>(null);
  const auswahlHatOrt = auswahl?.ort != null;
  useEffect(() => {
    if (!auswahlLeadId) {
      geflogenFuer.current = null;
      return;
    }
    if (geflogenFuer.current === auswahlLeadId) return;
    geflogenFuer.current = auswahlLeadId;
    if (auswahlHatOrt && imFilter) fahre("auswahl");
  }, [auswahlLeadId, auswahlHatOrt, imFilter, fahre]);

  /* ── WebGL-Rückfall: Liste in voller Breite ── */
  const [ohneKarte, setOhneKarte] = useState(() => !hatWebgl2());
  const [tab, setTab] = useState<LeistenTab>(() => (ohneKarte ? "alle" : "wartet"));
  const beiKartenFehler = useCallback((grund: "webgl" | "sonst", meldung: string) => {
    if (grund === "webgl") {
      setOhneKarte(true);
      setTab("alle");
    } else {
      console.warn("[Lagekarte] Kartenfehler:", meldung);
    }
  }, []);

  /* ── HUD-Höhe messen: Leiste, Panel und Quellenangabe beginnen darunter ── */
  const [hudEl, setHudEl] = useState<HTMLDivElement | null>(null);
  const [hudHoehe, setHudHoehe] = useState(84);
  useEffect(() => {
    if (!hudEl) return;
    const beobachter = new ResizeObserver(() => setHudHoehe(Math.round(hudEl.getBoundingClientRect().height)));
    beobachter.observe(hudEl);
    return () => beobachter.disconnect();
  }, [hudEl]);
  const obenPx = HUD_OBEN_PX + hudHoehe + HUD_ABSTAND_PX;
  // Aufgeklapptes Sheet endet oben 8 px unter dem (gemessenen) HUD.
  const sheetOffenHoehe = `min(72vh, calc(100% - ${obenPx}px))`;

  /* ── Mobiles Sheet ── */
  const [sheetOffen, setSheetOffen] = useState(false);
  const wischStart = useRef<number | null>(null);
  const gewischt = useRef(false);

  const schliesseAuswahl = useCallback(() => waehle(null), [waehle]);

  const beiTab = useCallback(
    (t: LeistenTab) => {
      setTab(t);
      if (mobil) setSheetOffen(true);
    },
    [mobil],
  );

  const beiWartetKlick = useCallback(() => {
    setTab("wartet");
    if (mobil) {
      setSheetOffen(true);
      if (auswahlId) waehle(null);
    }
  }, [mobil, auswahlId, waehle]);

  const erstesLaden = daten === null;
  const panelOffen = auswahl !== null;

  const leiste = (kompakt: boolean) => (
    <Leiste
      leadsGefiltert={leadsGefiltert}
      missionen={daten?.missionen ?? []}
      firmen={firmen}
      jetzt={jetzt}
      auswahlId={auswahlId}
      onWaehle={waehle}
      suche={suche}
      onSuche={setSuche}
      tab={tab}
      onTab={beiTab}
      kompakt={kompakt}
    />
  );

  const legende = daten && (
    <Legende
      filter={filter}
      setzeFilter={setzeFilter}
      zuruecksetzen={zuruecksetzenAlles}
      statusZahlen={statusZahlen}
      firmen={firmen}
      firmenZahlen={firmenZahlen}
      thema={thema}
      trefferGesamt={leadsGefiltert.length}
      trefferMitOrt={trefferMitOrt}
      mobil={mobil}
    />
  );

  const legendeMobilSichtbar = mobil && !panelOffen && !sheetOffen;

  /* ── Verdeckte Kartenränder für die Kamera (Ruling 10): offenes Panel rechts, Legende bzw.
     Sheet unten, HUD oben, Leiste links. „Ganz BW“, „Kerngebiet“ und Auswahl passen in den Rest. ── */
  const [setWurzelEl, wurzelHoehe] = useHoehe();
  const [setLegendeEl, legendeHoehe] = useHoehe();
  const [setSheetEl, sheetHoehe] = useHoehe();
  const verdeckt = useMemo<Rand>(() => {
    if (mobil) {
      const unten = panelOffen
        ? mobilPanelHoehe(wurzelHoehe)
        : (sheetHoehe || SHEET_PEEK_PX) + (legendeMobilSichtbar && legendeHoehe > 0 ? legendeHoehe + 8 : 0);
      return { top: obenPx, bottom: unten, left: 12, right: 12 };
    }
    return {
      top: obenPx,
      bottom: 12 + legendeHoehe,
      left: LEISTE_RAUM_PX,
      right: panelOffen ? PANEL_RAUM_PX : 12,
    };
  }, [mobil, panelOffen, wurzelHoehe, sheetHoehe, legendeMobilSichtbar, legendeHoehe, obenPx]);
  // --lk-oben: Oberkante von Leiste, Panel und Quellenangabe (unter dem HUD).
  // --lk-attr-rechts: Quellenangabe (oben rechts) neben das offene Panel schieben.
  const wurzelStil = {
    "--lk-oben": `${obenPx}px`,
    "--lk-attr-rechts": !mobil && panelOffen ? `${PANEL_RAUM_PX - 12}px` : "0px",
  } as CSSProperties;

  const wurzelKlasse = `lagekarte ${thema === "dunkel" ? "lagekarte--dunkel" : ""} relative isolate h-full w-full overflow-hidden`;

  return (
    <ThemaKontext.Provider value={thema}>
      <div
        ref={setWurzelEl}
        className={wurzelKlasse}
        style={wurzelStil}
        data-testid="lagekarte"
        data-ansicht={ansicht}
        data-panel={!mobil && panelOffen ? "offen" : undefined}
      >
        {/* Karte füllt alles */}
        {!ohneKarte && (
          <div className="absolute inset-0">
            <Spielbrett
              leads={leadsGefiltert}
              firmen={firmen}
              thema={thema}
              ansicht={ansicht}
              auswahlId={auswahlId}
              onWaehle={waehle}
              kamera={kamera}
              verdeckt={verdeckt}
              onFehler={beiKartenFehler}
            />
          </div>
        )}

        {/* HUD oben (z-30: sein Menü klappt mobil über Legende und Sheet) */}
        {daten && (
          <div ref={setHudEl} className="@container absolute top-3 right-3 left-3 z-30">
            <Hud
              kennzahlen={daten.kennzahlen}
              stand={daten.stand}
              aktualisiertFehler={fehler !== null}
              ansicht={ansicht}
              onAnsicht={setzeAnsicht}
              onListe={onListe}
              onKamera={fahre}
              onWartetKlick={beiWartetKlick}
            />
          </div>
        )}

        {/* Ohne WebGL2: Hinweis und Liste in voller Breite */}
        {daten && ohneKarte && (
          <div
            className={`absolute bottom-3 left-3 z-10 flex flex-col gap-2 ${!mobil && panelOffen ? "right-[424px]" : "right-3"}`}
            style={{ top: "var(--lk-oben)" }}
          >
            <div className="lk-glas flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5" role="status">
              <AlertTriangle className="size-4 shrink-0" style={{ color: "var(--lk-warn)" }} aria-hidden="true" />
              <p className="min-w-0 flex-1 text-[13px]" style={{ color: "var(--lk-text)" }}>
                Die Karte braucht WebGL2. Du siehst die Listenansicht.
              </p>
              <button
                type="button"
                onClick={onListe}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--lk-panel-rand)] px-3 text-[12.5px] font-medium text-[var(--lk-text)] hover:bg-[var(--lk-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lk-akzent)]"
              >
                <LayoutList className="size-4" aria-hidden="true" /> Klassische Startseite
              </button>
            </div>
            <div className="min-h-0 flex-1">{leiste(false)}</div>
          </div>
        )}

        {/* Desktop: Leiste links, Legende unten mittig */}
        {daten && !ohneKarte && !mobil && (
          <>
            <div className="absolute bottom-3 left-3 z-10 w-[340px]" style={{ top: "var(--lk-oben)" }}>
              {leiste(false)}
            </div>
            <div
              className="@container pointer-events-none absolute bottom-3 z-10 flex justify-center"
              style={{ left: LEISTE_RAUM_PX, right: panelOffen ? PANEL_RAUM_PX : 12 }}
            >
              <div ref={setLegendeEl} className="pointer-events-auto max-w-full">
                {legende}
              </div>
            </div>
          </>
        )}

        {/* Mobil: Legende als Scroll-Leiste über dem Sheet, Leiste als Bottom-Sheet */}
        {daten && !ohneKarte && mobil && !panelOffen && (
          <>
            {legendeMobilSichtbar && (
              <div ref={setLegendeEl} className="@container absolute right-3 left-3 z-10" style={{ bottom: SHEET_PEEK_PX + 8 }}>
                {legende}
              </div>
            )}
            <section
              ref={setSheetEl}
              aria-label="Leadliste"
              className="lk-glas lk-sheet absolute inset-x-0 bottom-0 z-20 flex flex-col"
              style={{ height: sheetOffen ? sheetOffenHoehe : SHEET_PEEK_PX }}
              onFocusCapture={(e) => {
                if ((e.target as HTMLElement).tagName === "INPUT") setSheetOffen(true);
              }}
            >
              <button
                type="button"
                aria-expanded={sheetOffen}
                aria-label={sheetOffen ? "Liste einklappen" : "Liste aufklappen"}
                onClick={() => {
                  // Nach einem Wischen kommt noch ein Klick: der darf nicht zurückklappen.
                  if (gewischt.current) {
                    gewischt.current = false;
                    return;
                  }
                  setSheetOffen((o) => !o);
                }}
                onPointerDown={(e) => {
                  // Fangen: der Finger verlässt beim Wischen den Griff sofort.
                  e.currentTarget.setPointerCapture(e.pointerId);
                  wischStart.current = e.clientY;
                  gewischt.current = false;
                }}
                onPointerUp={(e) => {
                  const start = wischStart.current;
                  wischStart.current = null;
                  if (start === null) return;
                  const dy = e.clientY - start;
                  if (Math.abs(dy) > 24) {
                    gewischt.current = true;
                    setSheetOffen(dy < 0);
                  }
                }}
                // 44 px Trefferfläche, Balken optisch wie vorher oben; die unteren 8 px liegen
                // (z-10) über dem leeren oberen Polster der Leiste, nicht über der Suche.
                className="relative z-10 -mb-2 flex h-11 w-full shrink-0 touch-none items-start justify-center pt-[11px] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--lk-akzent)]"
              >
                <span className="h-1.5 w-10 rounded-full" style={{ background: "var(--lk-text-schwach)", opacity: 0.5 }} />
              </button>
              <div className="min-h-0 flex-1">{leiste(true)}</div>
            </section>
          </>
        )}

        {/* Lead-Panel positioniert sich selbst (Desktop rechts, mobil als Sheet) */}
        {auswahl && (
          <LeadPanel
            lead={auswahl}
            firmen={firmen}
            stufen={daten?.stufen ?? []}
            imFilter={imFilter}
            jetzt={jetzt}
            startTab={startTab}
            onSchliessen={schliesseAuswahl}
            onGeaendert={() => void neuLaden()}
            mobil={mobil}
          />
        )}

        {/* Erstes Laden: Skelett mit Brett-Silhouette (Karte baut sich darunter schon auf) */}
        {erstesLaden && !fehler && (
          <div className="absolute inset-0 z-40 flex items-center justify-center" style={{ background: "var(--lk-bg)" }}>
            <BrettSilhouette />
          </div>
        )}

        {/* Fehler beim ersten Laden: Karte bleibt, Hinweis mit Wiederholen */}
        {erstesLaden && fehler && (
          <div className="absolute inset-0 z-40 flex items-center justify-center p-4">
            <div className="lk-glas flex max-w-sm flex-col items-center gap-3 px-6 py-5 text-center" role="alert">
              <AlertTriangle className="size-6" style={{ color: "var(--lk-wartet)" }} aria-hidden="true" />
              <div>
                <p className="text-[15px] font-semibold" style={{ color: "var(--lk-text)" }}>
                  Die Lage konnte nicht geladen werden.
                </p>
                <p className="mt-1 text-[13px]" style={{ color: "var(--lk-text-leise)" }}>
                  {fehler}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => void neuLaden()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lk-akzent)]"
                  style={{ background: "var(--lk-blase-aus)", color: "var(--lk-blase-aus-text)" }}
                >
                  <RotateCw className="size-4" aria-hidden="true" /> Erneut versuchen
                </button>
                <button
                  type="button"
                  onClick={onListe}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--lk-panel-rand)] px-4 text-[13px] font-medium text-[var(--lk-text)] hover:bg-[var(--lk-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lk-akzent)]"
                >
                  <LayoutList className="size-4" aria-hidden="true" /> Klassische Startseite
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ThemaKontext.Provider>
  );
}

"use client";

import "@/styles/neu-plan.css";

import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  useSensor,
  useSensors,
  type Active,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { motionReduced } from "@/components/glassyui/lib/liquid-motion";
import { apiAufruf } from "@/components/neu/akte/api";
import { TerminDialog } from "@/components/neu/termin/termin-dialog";
import { useBreit } from "@/components/neu/breit";
import { filterAktiv as leadsFilterAktiv } from "@/components/neu/leads/leads-logik";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import { tagKurz } from "@/lib/anzeige";
import { berlinDateString } from "@/lib/berlin-date";
import type { LeadsFilter } from "@/lib/leads-board";
import {
  IM_BLICK_MAX,
  imBlickAus,
  planFenster,
  type PlanAbfrage,
  type PlanAntwort,
  type PlanEintrag,
  type PlanImBlick as ImBlickChip,
  type PlanSeitenZustand,
} from "@/lib/plan-heute";
import { BestaetigenDialog } from "./bestaetigen-dialog";
import { EintragPopover } from "./eintrag-popover";
import { KundeInformieren } from "./kunde-informieren";
import { hatKapazitaet, kapazitaetGemerkt, kapazitaetMerken } from "./kapazitaet-chip";
import { Legende } from "./legende";
import { EintragInhalt } from "./plan-eintrag";
import { PlanImBlick } from "./plan-im-blick";
import { PlanKopf } from "./plan-kopf";
import { PlanLeiste } from "./plan-leiste";
import {
  LEER_TEXT,
  ZUG_RUHE,
  abfrageFuer,
  antwortUebernehmen,
  deckt,
  fensterVon,
  gespeichertText,
  imBlickKlick,
  leerArt,
  neuLadenAbfrage,
  planUrl,
  schwebend,
  sichtbareEintraege,
  tagAusAblageId,
  verschiebenZug,
  zugLaeuft,
  zugWeiter,
  type GeladenesFenster,
  type Schreibzug,
} from "./plan-logik";
import { PlanMonat, type RasterProps } from "./plan-monat";
import { PlanTag } from "./plan-tag";
import { PlanWoche } from "./plan-woche";
import { TerminNeu } from "./termin-neu";
import { terminSetzen } from "./termin-setzen";
import { VerschiebenDialog } from "./verschieben-dialog";

/** Plan alle 60 s still neu (Entscheidung 19), nur bei sichtbarem Tab, nicht während Ziehen oder Dialog. */
const TAKT_MS = 60_000;
/** So lange nach dem Ende eines Zugs gilt ein Klick noch als Teil des Zugs. */
const KLICK_SPERRE_MS = 400;

type Grund = "oeffnen" | "wechsel" | "takt" | "aktion";
/** `fuer`: Fenster und Filter, zu denen die Antwort gehört; gezeigt wird sie nur, wenn sie das sichtbare Fenster abdeckt. */
type Daten = { art: "laden" } | { art: "fehler"; meldung: string } | { art: "fertig"; antwort: PlanAntwort; fuer: GeladenesFenster };
type Dialog =
  | { art: "bestaetigen"; eintrag: PlanEintrag; stufe: { id: string; label: string } }
  | { art: "angebote"; dealId: string };

/**
 * Der Plan (Plan 8, Entscheidungen 4 bis 19): Kern für `/app/plan` und den
 * Kalender in `/app/leads`. Lädt `GET /api/v1/plan` für das Fenster der
 * Ansicht (nicht erneut, wenn das neue Fenster im geladenen liegt), alle 60 s
 * still (nur sichtbarer Tab, pausiert während Ziehen, Popover oder Dialog;
 * Lauf-Zähler gegen veraltete Antworten). Zeigt „Im Blick“ (nur auf der
 * Plan-Seite), die Leiste und Monat, Woche oder Tag; am Handy immer den Tag,
 * ohne Umschalter und ohne Ziehen. Geschrieben wird nur nach Rückfrage über
 * `terminSetzen` bzw. `stufeSetzen`; nichts optimistisch.
 */
export function PlanAnsicht({
  zustand,
  onZustand,
  leads,
  onFilterZuruecksetzen,
  onGeaendert,
}: {
  zustand: PlanSeitenZustand;
  onZustand: (z: PlanSeitenZustand) => void;
  /** Leads-Kalender: die aktuellen Leads-Filter; null = Plan-Seite. */
  leads: LeadsFilter | null;
  /** Leads-Kalender: „Filter zurücksetzen“ setzt die Leads-Filter zurück. */
  onFilterZuruecksetzen?: () => void;
  /** Nach jedem Schreiben (Tag, Stufe, Terminangebote): etwa die Leads-Chips neu laden. */
  onGeaendert?: () => void;
}) {
  const breit = useBreit();
  const kompakt = breit === false;
  // Plan 12a: „Kapazität anzeigen“, gemerkt je Browser (erst nach dem Einhängen gelesen).
  const [kapAn, setKapAn] = useState(true);
  useEffect(() => setKapAn(kapazitaetGemerkt()), []);
  const portalZiel = usePortalZiel();
  const z: PlanSeitenZustand = kompakt && zustand.modus !== "tag" ? { ...zustand, modus: "tag" } : zustand;
  const abfrage = useMemo(() => abfrageFuer(z, leads), [z.modus, z.anker, z.firmaId, z.mitarbeiterId, leads]); // eslint-disable-line react-hooks/exhaustive-deps
  const abfrageKey = JSON.stringify(abfrage);

  const [daten, setDaten] = useState<Daten>({ art: "laden" });
  const [laedt, setLaedt] = useState(false);
  const [zug, schick] = useReducer(zugWeiter, ZUG_RUHE);
  const [auswahl, setAuswahl] = useState<{ eintrag: PlanEintrag; anker: HTMLElement } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [nurNichtFest, setNurNichtFest] = useState(false);
  const [blickOffen, setBlickOffen] = useState(false);
  const [ziehend, setZiehend] = useState(false);

  const lauf = useRef(0);
  const geladen = useRef<GeladenesFenster | null>(null);
  const hatDaten = useRef(false);
  hatDaten.current = daten.art === "fertig";
  const abfrageRef = useRef(abfrage);
  abfrageRef.current = abfrage;
  const onGeaendertRef = useRef(onGeaendert);
  onGeaendertRef.current = onGeaendert;
  const pausiert = useRef(false);
  pausiert.current = zugLaeuft(zug) || dialog !== null || auswahl !== null || ziehend;

  const laden = useCallback(async (a: PlanAbfrage, grund: Grund) => {
    const dieser = ++lauf.current;
    const fuer = fensterVon(a);
    if (grund !== "takt") setLaedt(true);
    const r = await apiAufruf<PlanAntwort>(planUrl(a));
    // Nur der letzte Lauf und nur, wenn er das gerade sichtbare Fenster abdeckt (sonst fremde Daten unter falscher Überschrift).
    if (!antwortUebernehmen({ lauf: dieser, aktuell: lauf.current, fuer, sichtbar: abfrageRef.current })) return;
    setLaedt(false);
    if (r.ok) {
      geladen.current = fuer;
      setDaten({ art: "fertig", antwort: r.data, fuer });
      return;
    }
    if (grund === "takt") return;
    if (grund === "aktion" && hatDaten.current) {
      toast.error("Plan konnte nicht neu geladen werden.", { description: r.message });
      return;
    }
    // Öffnen oder neues Fenster: alte Daten passen nicht mehr zum Zeitraum.
    geladen.current = null;
    setDaten({ art: "fehler", meldung: r.message });
  }, []);

  /** Takt und nach Aktionen: das geladene Fenster, solange es das sichtbare abdeckt, sonst das sichtbare. */
  const neuLaden = useCallback((grund: "takt" | "aktion") => laden(neuLadenAbfrage(geladen.current, abfrageRef.current), grund), [laden]);

  // Erst laden, wenn die Breite feststeht: am Handy gilt immer der Tag, sonst lädt der Monat umsonst.
  const breiteBekannt = breit !== null;
  useEffect(() => {
    if (!breiteBekannt) return;
    const a = abfrageRef.current;
    if (deckt(geladen.current, a)) {
      // Zurück in ein schon geladenes Fenster: ein laufender Abruf für ein anderes Fenster gilt nicht mehr.
      lauf.current += 1;
      setLaedt(false);
      return;
    }
    void laden(a, hatDaten.current ? "wechsel" : "oeffnen");
  }, [abfrageKey, laden, breiteBekannt]);

  useEffect(() => {
    const takt = () => {
      if (document.hidden || pausiert.current) return;
      void neuLaden("takt");
    };
    const id = window.setInterval(takt, TAKT_MS);
    document.addEventListener("visibilitychange", takt);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", takt);
    };
  }, [neuLaden]);

  // Speichern genau einmal je Zug (auch im Strict Mode); Abbrechen ist während des Speicherns gesperrt.
  const speichertFuer = useRef<Schreibzug | null>(null);
  useEffect(() => {
    if (zug.art !== "speichert" || speichertFuer.current === zug.zug) return;
    const z = zug.zug;
    speichertFuer.current = z;
    void terminSetzen(z.dealId, z.werte).then((fehler) => {
      speichertFuer.current = null;
      if (fehler) {
        schick({ typ: "fehler", meldung: fehler });
        return;
      }
      toast.success(gespeichertText(z));
      schick({ typ: "gespeichert" });
      void neuLaden("aktion");
      onGeaendertRef.current?.();
    });
  }, [zug, neuLaden]);

  // Nur Daten, die das sichtbare Fenster abdecken; Stammdaten (Firmen, Mitarbeiter) dürfen aus der letzten Antwort bleiben.
  const letzte = daten.art === "fertig" ? daten.antwort : null;
  const antwort = daten.art === "fertig" && deckt(daten.fuer, abfrage) ? daten.antwort : null;
  const heute = letzte?.heute ?? berlinDateString();
  const fenster = planFenster(z.modus, z.anker);
  const imFenster = useMemo(() => (antwort ? sichtbareEintraege(antwort.eintraege, fenster, false) : []), [antwort, fenster.von, fenster.bis]); // eslint-disable-line react-hooks/exhaustive-deps
  const blick = useMemo(() => (leads ? [] : imBlickAus(imFenster, heute, blickOffen ? Number.POSITIVE_INFINITY : IM_BLICK_MAX)), [imFenster, heute, blickOffen, leads]);
  const nichtFestAn = nurNichtFest && blick.some((c) => c.art === "nicht_fest");
  const sichtbar = nichtFestAn ? imFenster.filter((e) => e.ton === "gestrichelt") : imFenster;
  const filterAn = nichtFestAn || z.mitarbeiterId !== null || (leads ? leadsFilterAktiv(leads) : z.firmaId !== null);
  const leer = antwort && !laedt ? leerArt(sichtbar.length, filterAn) : null;

  // Am Handy bleibt die gespeicherte Ansicht unberührt: der Modus der Seite geht unverändert zurück.
  const setzen = useCallback(
    (neu: PlanSeitenZustand) => onZustand(kompakt ? { ...neu, modus: zustand.modus } : neu),
    [kompakt, onZustand, zustand.modus]
  );

  const zuruecksetzen = useCallback(() => {
    setNurNichtFest(false);
    if (leads) onFilterZuruecksetzen?.();
    setzen({ ...z, firmaId: null, mitarbeiterId: null });
  }, [leads, onFilterZuruecksetzen, setzen, z]);

  const zurTag = useCallback((tag: string) => setzen({ ...z, modus: "tag", anker: tag }), [setzen, z]);

  const blickKlick = useCallback(
    (c: ImBlickChip) => {
      const f = imBlickKlick(c, nichtFestAn);
      if (f.art === "tag") zurTag(f.tag);
      else if (f.art === "nicht_fest") setNurNichtFest(f.an);
      else setBlickOffen(true);
    },
    [nichtFestAn, zurTag]
  );

  const ablegen = useCallback(
    (e: PlanEintrag, ziel: string) => {
      const r = verschiebenZug(e, ziel, heute);
      if ("zug" in r) schick({ typ: "start", zug: r.zug });
      else if (r.hinweis) toast.message(r.hinweis);
    },
    [heute]
  );

  const waehlen = useCallback((e: PlanEintrag, anker: HTMLElement) => setAuswahl({ eintrag: e, anker }), []);

  const schwebt = schwebend(zug);
  const schwebendEintrag = schwebt && antwort ? antwort.eintraege.find((e) => e.id === schwebt.eintragId) ?? null : null;

  const leerHinweis = leer ? (
    <div className="plan-leer" role="status">
      <p>{LEER_TEXT[leer]}</p>
      {leer === "filter" ? (
        <GlassButton size="sm" variant="soft" onClick={zuruecksetzen}>
          Filter zurücksetzen
        </GlassButton>
      ) : null}
    </div>
  ) : null;

  const kapAktiv = kapAn && hatKapazitaet(antwort?.kapazitaet);
  const raster: Omit<RasterProps, "ziehend" | "klickErlaubt"> = {
    kapazitaet: kapAktiv && antwort ? new Map(antwort.kapazitaet.map((k) => [k.tag, k])) : null,
    anker: z.anker,
    heute,
    eintraege: sichtbar,
    ziehen: !kompakt && !zugLaeuft(zug),
    schwebend: schwebt && schwebendEintrag ? { eintrag: schwebendEintrag, ziel: schwebt.ziel } : null,
    onWaehlen: waehlen,
    onTag: zurTag,
  };

  let inhalt: ReactNode;
  if (daten.art === "laden" || (daten.art === "fertig" && !antwort)) {
    // Auch beim Wechsel in ein noch nicht geladenes Fenster: lieber Skelett als Daten eines anderen Zeitraums.
    inhalt = <PlanSkelett modus={z.modus} />;
  } else if (daten.art === "fehler") {
    inhalt = (
      <div className="plan-hinweis" role="alert">
        <p>Plan konnte nicht geladen werden. {daten.meldung}</p>
        <GlassButton size="sm" onClick={() => void laden(abfrageRef.current, "oeffnen")}>
          Erneut versuchen
        </GlassButton>
      </div>
    );
  } else if (z.modus === "tag") {
    inhalt = (
      <GlassPanel variant="panel" className="plan-raster plan-raster-tag" data-laedt={laedt || undefined}>
        <PlanTag tag={z.anker} eintraege={sichtbar} leer={leerHinweis ?? <p className="plan-leer-still">{laedt ? "Lädt …" : LEER_TEXT.zeitraum}</p>} onWaehlen={waehlen} />
      </GlassPanel>
    );
  } else {
    inhalt = (
      <>
        {leerHinweis}
        <Ziehflaeche aktiv={raster.ziehen} portalZiel={portalZiel} onZiehen={setZiehend} onAblegen={ablegen}>
          {(klickErlaubt) => (
            <GlassPanel variant="panel" className="plan-raster" data-modus={z.modus} data-laedt={laedt || undefined} data-ziehend={ziehend || undefined}>
              {z.modus === "monat" ? (
                <PlanMonat {...raster} ziehend={ziehend} klickErlaubt={klickErlaubt} />
              ) : (
                <PlanWoche {...raster} ziehend={ziehend} klickErlaubt={klickErlaubt} />
              )}
              <Legende
                abo={!leads}
                kapazitaet={
                  hatKapazitaet(antwort?.kapazitaet)
                    ? {
                        an: kapAn,
                        onUmschalten: (an) => {
                          setKapAn(an);
                          kapazitaetMerken(an);
                        },
                      }
                    : null
                }
              />
            </GlassPanel>
          )}
        </Ziehflaeche>
      </>
    );
  }

  return (
    <div className="plan" data-im-leads={leads ? true : undefined}>
      {leads ? null : (
        <PlanKopf
          kompakt={kompakt}
          aktion={
            <TerminNeu
              heute={heute}
              besichtigungFeld={letzte?.besichtigungFeld ?? null}
              portalZiel={portalZiel}
              onZug={(zg) => schick({ typ: "start", zug: zg })}
              onAngebote={(dealId) => setDialog({ art: "angebote", dealId })}
            />
          }
        />
      )}
      {leads ? null : <PlanImBlick chips={blick} nurNichtFest={nichtFestAn} onKlick={blickKlick} />}
      <PlanLeiste
        zustand={z}
        heute={heute}
        firmen={letzte?.firmen ?? []}
        mitarbeiter={letzte?.mitarbeiter ?? []}
        imLeads={leads !== null}
        kompakt={kompakt}
        onZustand={setzen}
      />
      {inhalt}

      {auswahl && antwort ? (
        <EintragPopover
          key={auswahl.eintrag.id}
          eintrag={auswahl.eintrag}
          anker={auswahl.anker}
          heute={heute}
          stufen={antwort.stufen}
          kompakt={kompakt}
          portalZiel={portalZiel}
          onSchliessen={() => setAuswahl(null)}
          onVerschieben={(e, ziel) => {
            const r = verschiebenZug(e, ziel, heute);
            if ("zug" in r) {
              setAuswahl(null);
              schick({ typ: "start", zug: r.zug });
              return null;
            }
            return r.hinweis ?? "Der Umzug steht schon auf diesem Tag.";
          }}
          onBestaetigen={(e, stufe) => {
            setAuswahl(null);
            setDialog({ art: "bestaetigen", eintrag: e, stufe });
          }}
          onTerminangebote={(e) => {
            setAuswahl(null);
            setDialog({ art: "angebote", dealId: e.dealId });
          }}
        />
      ) : null}

      {zug.art === "frage" || zug.art === "speichert" ? (
        <VerschiebenDialog
          key={`${zug.zug.dealId}:${zug.zug.ziel}`}
          zug={zug.zug}
          fehler={zug.art === "frage" ? zug.fehler : null}
          speichert={zug.art === "speichert"}
          portalZiel={portalZiel}
          onAbbrechen={() => schick({ typ: "abbrechen" })}
          onBestaetigen={() => schick({ typ: "bestaetigen" })}
        />
      ) : null}

      {zug.art === "informieren" || zug.art === "vorlage" ? (
        <KundeInformieren
          key={`${zug.zug.dealId}:${zug.zug.ziel}`}
          dealId={zug.zug.dealId}
          name={zug.zug.name}
          ziel={zug.zug.ziel}
          vorlage={zug.art === "vorlage"}
          portalZiel={portalZiel}
          onVorlage={() => schick({ typ: "vorlage" })}
          onFertig={() => schick({ typ: "fertig" })}
        />
      ) : null}

      {dialog?.art === "bestaetigen" ? (
        <BestaetigenDialog
          eintrag={dialog.eintrag}
          stufe={dialog.stufe}
          portalZiel={portalZiel}
          onEnde={(gesetzt) => {
            setDialog(null);
            if (gesetzt) {
              toast.success(`${dialog.eintrag.titel}: Durchführung bestätigt.`);
              void neuLaden("aktion");
              onGeaendertRef.current?.();
            }
          }}
        />
      ) : null}

      {dialog?.art === "angebote" ? (
        <TerminDialog
          dealId={dialog.dealId}
          portalZiel={portalZiel}
          onSchliessen={() => {
            setDialog(null);
            void neuLaden("aktion");
            onGeaendertRef.current?.();
          }}
        />
      ) : null}
    </div>
  );
}

// ─── Ziehen ──────────────────────────────────────────────────────────────────

/** Zeiger im Rechteck der Ablagefläche, sonst nichts (kein Raten nach Nähe; wie das Board). */
const zeigerImRechteck: CollisionDetection = ({ droppableContainers, pointerCoordinates }) => {
  if (!pointerCoordinates) return [];
  for (const c of droppableContainers) {
    const node = c.node.current;
    if (!node || c.disabled) continue;
    const r = node.getBoundingClientRect();
    if (pointerCoordinates.x >= r.left && pointerCoordinates.x <= r.right && pointerCoordinates.y >= r.top && pointerCoordinates.y <= r.bottom) {
      return [{ id: c.id, data: { droppableContainer: c, value: 0 } }];
    }
  }
  return [];
};

const MESSEN = { droppable: { strategy: MeasuringStrategy.Always } };

const ANLEITUNG = {
  draggable: "Umzug mit dem Zeiger auf einen anderen Tag ziehen. Ohne Maus: Eintrag öffnen und „Verschieben auf …“ wählen.",
};

function eintragAus(active: Active): PlanEintrag | null {
  return (active.data.current as { eintrag?: PlanEintrag } | undefined)?.eintrag ?? null;
}

function tagName(id: string | number | undefined): string {
  const tag = tagAusAblageId(id);
  return tag ? tagKurz(tag) : "keinem Tag";
}

/**
 * Ziehen im Monat und in der Woche (Entscheidung 7): `@dnd-kit/core` wie das
 * Board (Zeiger, Abstand 5, Ablage nur im Rechteck eines Tages ab heute).
 * Die Überlagerung liegt im Portalziel außerhalb des Glases; bei reduzierter
 * Bewegung ohne Rückflug. Abgelegt wird nur gemeldet; der Plan fragt nach.
 */
function Ziehflaeche({
  aktiv,
  portalZiel,
  onZiehen,
  onAblegen,
  children,
}: {
  aktiv: boolean;
  portalZiel: HTMLElement | undefined;
  onZiehen: (ziehend: boolean) => void;
  onAblegen: (e: PlanEintrag, tag: string) => void;
  children: (klickErlaubt: () => boolean) => ReactNode;
}) {
  const [gezogen, setGezogen] = useState<PlanEintrag | null>(null);
  const [reduziert, setReduziert] = useState(false);
  const letzterZug = useRef(0);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const klickErlaubt = useCallback(() => Date.now() - letzterZug.current > KLICK_SPERRE_MS, []);

  useEffect(() => {
    setReduziert(motionReduced());
  }, []);

  function start(e: DragStartEvent) {
    const eintrag = eintragAus(e.active);
    if (!eintrag || !aktiv) return;
    setGezogen(eintrag);
    onZiehen(true);
  }

  function ende(e: DragEndEvent) {
    letzterZug.current = Date.now();
    const eintrag = gezogen;
    setGezogen(null);
    onZiehen(false);
    const tag = tagAusAblageId(e.over?.id);
    if (eintrag && tag) onAblegen(eintrag, tag);
  }

  function abbruch() {
    letzterZug.current = Date.now();
    setGezogen(null);
    onZiehen(false);
  }

  const ansagen: Announcements = {
    onDragStart: ({ active }) => `${eintragAus(active)?.titel ?? "Eintrag"} aufgenommen.`,
    onDragOver: ({ active, over }) => `${eintragAus(active)?.titel ?? "Eintrag"} über ${tagName(over?.id)}.`,
    onDragEnd: ({ active, over }) =>
      over ? `${eintragAus(active)?.titel ?? "Eintrag"} auf ${tagName(over.id)} abgelegt.` : `${eintragAus(active)?.titel ?? "Eintrag"} zurückgelegt.`,
    onDragCancel: ({ active }) => `Ziehen abgebrochen, ${eintragAus(active)?.titel ?? "Eintrag"} bleibt.`,
  };

  const ueberlagerung = (
    <DragOverlay dropAnimation={reduziert ? null : undefined}>
      {gezogen ? (
        <div className="plan-eintrag plan-eintrag-ueberlagerung" data-ton={gezogen.ton}>
          <EintragInhalt eintrag={gezogen} woche={false} />
        </div>
      ) : null}
    </DragOverlay>
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={zeigerImRechteck}
      measuring={MESSEN}
      autoScroll
      accessibility={{ announcements: ansagen, screenReaderInstructions: ANLEITUNG }}
      onDragStart={start}
      onDragEnd={ende}
      onDragCancel={abbruch}
    >
      {children(klickErlaubt)}
      {portalZiel ? createPortal(ueberlagerung, portalZiel) : ueberlagerung}
    </DndContext>
  );
}

function PlanSkelett({ modus }: { modus: PlanSeitenZustand["modus"] }) {
  if (modus === "tag") {
    return (
      <div className="plan-raster plan-skelett" aria-busy="true" aria-label="Plan wird geladen">
        {Array.from({ length: 3 }, (_, i) => (
          <span key={i} className="lg-skeleton plan-skelett-zeile" />
        ))}
      </div>
    );
  }
  return (
    <div className="plan-raster plan-skelett" aria-busy="true" aria-label="Plan wird geladen">
      <div className="plan-skelett-raster" data-modus={modus}>
        {Array.from({ length: modus === "monat" ? 35 : 7 }, (_, i) => (
          <span key={i} className="lg-skeleton plan-skelett-zelle" />
        ))}
      </div>
    </div>
  );
}

"use client";
/**
 * Lagekarte: Legende = Filter. Schwebt unten mittig über der Karte. Status-
 * Chips (Form plus Farbe), „Wartet“-Chip, Firmen-Chips, Zeitraum-Segment,
 * „Wert ab“-Popover, Zurücksetzen und Trefferzeile.
 *
 * Desktop (Container-Layout ab lg) bricht die Legende immer um, sie scrollt
 * nie seitlich: mit der Maus käme man an versteckte Filter nur per
 * Shift+Rad. Maßgeblich ist der Platz, den der Container gibt (`@container`
 * am Rahmen), nicht die Fensterbreite: mit offenem Panel bleibt in der Mitte
 * oft wenig übrig. Stufen nach Containerbreite:
 * - ab 48rem (768 px): alles in der Leiste, 2 bis 3 Zeilen;
 * - darunter: Status-Chips, „Wartet“ und Treffer bleiben, Firma, Eingang und
 *   Wert liegen hinter dem immer sichtbaren Knopf „Filter (n)“ (Popover);
 * - unter 24rem (384 px): Status-Chips nur mit Form und Zahl (Name im
 *   Tooltip und für Screenreader);
 * - unter 14rem (224 px, z. B. 1024-px-Fenster mit offenem Panel): ausgeblendet.
 *
 * Mobil (`mobil`, Fenster unter lg) bleibt sie eine einzeilige Scroll-Leiste
 * über dem Sheet (Wischen ist dort natürlich), mit ausgeblendeten Rändern als
 * Hinweis, dass mehr kommt. Alle Chips und Knöpfe sind dort 44 px hoch.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Euro, ListFilter, RotateCcw, X } from "lucide-react";
import { FIRMA_OHNE, STANDARD_FILTER, weitereFilterAktiv, type KartenFilter, type Zeitraum } from "@/components/lagekarte/filter";
import { StatusForm } from "@/components/lagekarte/status-form";
import { STATUS_STIL, WARTET_FARBE, type Thema } from "@/lib/lagekarte/farben";
import { KARTEN_STATUS_REIHENFOLGE, type Firma, type KartenStatus } from "@/lib/lagekarte/typen";
import { cn } from "@/lib/utils";
import { randMaske, useUeberlaufKanten } from "./ueberlauf";
import { parseEuroEingabe } from "./wert-eingabe";

export interface LegendeProps {
  filter: KartenFilter;
  setzeFilter: (p: Partial<KartenFilter>) => void;
  zuruecksetzen: () => void;
  statusZahlen: Record<KartenStatus, number>;
  firmen: Firma[];
  /** id bzw. "ohne" → Anzahl bei aktuellem Filter ohne Firmenfilter. */
  firmenZahlen: Record<string, number>;
  thema: Thema;
  trefferGesamt: number;
  trefferMitOrt: number;
  /** Mobiles Container-Layout (Fenster unter lg): einzeilige Scroll-Leiste. */
  mobil?: boolean;
}

const FOKUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lk-akzent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--lk-panel)]";

const CHIP =
  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-2 text-[12.5px] font-medium whitespace-nowrap transition-colors max-lg:h-11 max-lg:px-3 " +
  "hover:bg-[var(--lk-hover)] active:bg-[var(--lk-aktiv)] " +
  FOKUS;

/* Container-Stufen (Desktop), siehe Kopfkommentar. */
/** Nur in der vollen Leiste (ab 48rem). */
const NUR_VOLL = "@max-[48rem]:hidden";
/** Unter 24rem nur noch für Screenreader (Chip zeigt Form bzw. Icon und Zahl). */
const KNAPP_SR = "@max-[24rem]:sr-only";

const ZEITRAEUME: Array<{ wert: Zeitraum; label: string; title: string }> = [
  { wert: "30", label: "30 T", title: "Eingang in den letzten 30 Tagen" },
  { wert: "90", label: "90 T", title: "Eingang in den letzten 90 Tagen" },
  { wert: "365", label: "12 M", title: "Eingang in den letzten 12 Monaten" },
  { wert: "alle", label: "Alle", title: "Alle Eingänge" },
];

const WERT_SCHNELLWAHL = [500, 1000, 2000, 5000];

const EURO = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

function gleicheMenge(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

/** Weicht der Filter vom Standard ab? (Suche zählt mit: Zurücksetzen leert sie auch.) */
export function istStandardFilter(f: KartenFilter): boolean {
  return (
    gleicheMenge(f.status, STANDARD_FILTER.status) &&
    f.nurWartet === STANDARD_FILTER.nurWartet &&
    f.firmen.length === 0 &&
    f.zeitraum === STANDARD_FILTER.zeitraum &&
    f.wertAbEuro === STANDARD_FILTER.wertAbEuro &&
    f.suche.trim() === ""
  );
}

/** Klick toggelt, Alt-Klick wählt nur diesen. */
function naechsteAuswahl<T extends string>(aktuell: readonly T[], wert: T, nurDieser: boolean): T[] {
  if (nurDieser) return [wert];
  return aktuell.includes(wert) ? aktuell.filter((x) => x !== wert) : [...aktuell, wert];
}

function Zahl({ n, aktiv }: { n: number; aktiv: boolean }) {
  return (
    <span className="k-mono text-[11px] tabular-nums" style={{ color: aktiv ? "var(--lk-text-leise)" : "var(--lk-text-schwach)" }}>
      {n}
    </span>
  );
}

function FirmenBadge({ firma }: { firma: Firma | null }) {
  if (firma === null) {
    return (
      <span
        aria-hidden="true"
        className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border border-dashed"
        style={{ borderColor: "var(--lk-text-schwach)" }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full text-[9px] leading-none font-semibold text-white"
      style={{ background: firma.farbe, boxShadow: "0 0 0 1px rgba(255,255,255,0.35) inset" }}
    >
      {firma.kurz}
    </span>
  );
}

function Trenner() {
  return <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 self-center" style={{ background: "var(--lk-panel-rand)" }} />;
}

/**
 * Eingabe „Wert ab“ mit Schnellwahl. Steht im eigenen Popover (volle Leiste,
 * mobil) und im Popover „Weitere Filter“. `nachAuswahl` schließt das eigene Popover
 * nach Enter oder Schnellwahl; in „Weitere Filter“ bleibt es offen.
 */
function WertFormular({
  wertAbEuro,
  setzen,
  nachAuswahl,
  autoFokus,
  id,
}: {
  wertAbEuro: number | null;
  setzen: (euro: number | null) => void;
  nachAuswahl?: () => void;
  autoFokus: boolean;
  id: string;
}) {
  // Entwurf im deutschen Format („1.500“), so wie der Chip den Wert zeigt.
  const [entwurf, setEntwurf] = useState(wertAbEuro === null ? "" : EURO.format(wertAbEuro));
  const [ungueltig, setUngueltig] = useState(false);
  const eingabeRef = useRef<HTMLInputElement>(null);
  const hinweisId = `${id}-hinweis`;
  /** Escape bricht ab: der Blur beim Schließen darf den Entwurf dann nicht übernehmen. */
  const abgebrochen = useRef(false);

  useEffect(() => {
    if (autoFokus) eingabeRef.current?.focus();
  }, [autoFokus]);

  // Wert von außen geändert (Schnellwahl, Zurücksetzen): Entwurf nachziehen.
  useEffect(() => {
    setEntwurf(wertAbEuro === null ? "" : EURO.format(wertAbEuro));
    setUngueltig(false);
  }, [wertAbEuro]);

  /** Übernimmt den Entwurf; false, wenn er unlesbar ist (dann bleibt der alte Wert). */
  const uebernehmen = (): boolean => {
    if (abgebrochen.current) return true;
    const ergebnis = parseEuroEingabe(entwurf);
    if (!ergebnis.gueltig) {
      setUngueltig(true);
      return false;
    }
    setzen(ergebnis.euro);
    return true;
  };

  return (
    <div
      onKeyDownCapture={(e) => {
        if (e.key === "Escape") abgebrochen.current = true;
      }}
    >
      <label
        className="flex h-10 items-center gap-2 rounded-lg border px-3 max-lg:h-11"
        style={{ borderColor: ungueltig ? "var(--lk-wartet)" : "var(--lk-panel-rand)", background: "var(--lk-panel-2)" }}
      >
        <span className="sr-only">Mindestwert in Euro</span>
        <input
          ref={eingabeRef}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder="z. B. 1.500"
          value={entwurf}
          aria-invalid={ungueltig || undefined}
          aria-describedby={ungueltig ? hinweisId : undefined}
          onChange={(e) => {
            setEntwurf(e.target.value);
            setUngueltig(false);
          }}
          onBlur={() => {
            uebernehmen();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (uebernehmen()) nachAuswahl?.();
            }
          }}
          className="k-mono min-w-0 flex-1 bg-transparent text-[14px] tabular-nums outline-none placeholder:text-[var(--lk-text-schwach)]"
          style={{ color: "var(--lk-text)" }}
        />
        <span className="text-[13px]" style={{ color: "var(--lk-text-leise)" }} aria-hidden="true">
          €
        </span>
      </label>
      {ungueltig && (
        <p id={hinweisId} role="alert" className="mt-1.5 text-[11.5px] leading-snug" style={{ color: "var(--lk-wartet)" }}>
          Bitte einen Betrag in Euro eingeben, zum Beispiel 1.500 oder 1.500,50.
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Schnellwahl">
        {WERT_SCHNELLWAHL.map((euro) => {
          const aktiv = wertAbEuro === euro;
          return (
            <button
              key={euro}
              type="button"
              aria-pressed={aktiv}
              onClick={() => {
                setzen(euro);
                nachAuswahl?.();
              }}
              className={cn(
                "h-9 rounded-full border px-3 text-[12.5px] font-medium tabular-nums transition-colors hover:bg-[var(--lk-hover)] max-lg:h-11",
                FOKUS,
              )}
              style={{
                borderColor: aktiv ? "var(--lk-akzent)" : "var(--lk-panel-rand)",
                color: "var(--lk-text)",
                background: aktiv ? "var(--lk-aktiv)" : "transparent",
              }}
            >
              {EURO.format(euro)} €
            </button>
          );
        })}
        {wertAbEuro !== null && (
          <button
            type="button"
            onClick={() => {
              setzen(null);
              nachAuswahl?.();
            }}
            className={cn("h-9 rounded-full px-3 text-[12.5px] font-medium transition-colors hover:bg-[var(--lk-hover)] max-lg:h-11", FOKUS)}
            style={{ color: "var(--lk-text-leise)" }}
          >
            Kein Mindestwert
          </button>
        )}
      </div>
      <p className="mt-2 text-[11.5px] leading-snug" style={{ color: "var(--lk-text-schwach)" }}>
        Leads ohne Wert werden ausgeblendet.
      </p>
    </div>
  );
}

/** Deckendes Popover über der Legende (die Legende ist Backdrop-Root, Weichzeichnen sähe die Karte nicht). */
function Popover({
  id,
  titel,
  ariaLabel,
  schliessen,
  className,
  children,
}: {
  id: string;
  titel: string;
  ariaLabel: string;
  schliessen: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      role="dialog"
      aria-label={ariaLabel}
      className={cn("lk-glas absolute bottom-full z-20 mb-2 p-3", className)}
      style={{ background: "var(--lk-panel)" }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          // Nicht bis zum Panel durchreichen (Esc dort schließt den Lead).
          e.stopPropagation();
          schliessen();
        }
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="k-label" style={{ color: "var(--lk-text-schwach)" }}>
          {titel}
        </span>
        <button
          type="button"
          onClick={schliessen}
          aria-label="Schließen"
          className={cn("inline-flex size-8 items-center justify-center rounded-full hover:bg-[var(--lk-hover)] max-lg:size-11", FOKUS)}
          style={{ color: "var(--lk-text-leise)" }}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      {children}
    </div>
  );
}

export default function Legende(p: LegendeProps) {
  const { filter, setzeFilter, thema, mobil = false } = p;
  const [wertOffen, setWertOffen] = useState(false);
  const [mehrOffen, setMehrOffen] = useState(false);
  const wurzelRef = useRef<HTMLDivElement>(null);
  const zeileRef = useRef<HTMLDivElement>(null);
  const wertKnopfRef = useRef<HTMLButtonElement>(null);
  const mehrKnopfRef = useRef<HTMLButtonElement>(null);
  const mehrRef = useRef<HTMLDivElement>(null);
  const wertId = useId();
  const mehrId = useId();
  const kanten = useUeberlaufKanten(zeileRef, mobil);

  useEffect(() => {
    if (!wertOffen && !mehrOffen) return;
    const aufKlick = (e: MouseEvent | TouchEvent) => {
      if (wurzelRef.current && !wurzelRef.current.contains(e.target as Node)) {
        setWertOffen(false);
        setMehrOffen(false);
      }
    };
    document.addEventListener("mousedown", aufKlick);
    document.addEventListener("touchstart", aufKlick);
    return () => {
      document.removeEventListener("mousedown", aufKlick);
      document.removeEventListener("touchstart", aufKlick);
    };
  }, [wertOffen, mehrOffen]);

  // „Weitere Filter“ geöffnet: Fokus auf das erste Bedienelement.
  useEffect(() => {
    if (mehrOffen) mehrRef.current?.querySelector<HTMLElement>("[data-erster-fokus]")?.focus();
  }, [mehrOffen]);

  // Wechselt die Stufe (Panel auf oder zu, Fenster breiter), verschwindet der Knopf eines
  // offenen Popovers: dann das Popover schließen, statt es ohne Anker stehen zu lassen.
  useEffect(() => {
    const wurzel = wurzelRef.current;
    if ((!wertOffen && !mehrOffen) || !wurzel) return;
    const unsichtbar = (knopf: HTMLElement | null) => !knopf || knopf.getClientRects().length === 0;
    const ro = new ResizeObserver(() => {
      if (unsichtbar(wertKnopfRef.current)) setWertOffen(false);
      if (unsichtbar(mehrKnopfRef.current)) setMehrOffen(false);
    });
    ro.observe(wurzel);
    return () => ro.disconnect();
  }, [wertOffen, mehrOffen]);

  const wertSchliessen = () => {
    setWertOffen(false);
    wertKnopfRef.current?.focus();
  };

  const mehrSchliessen = () => {
    setMehrOffen(false);
    mehrKnopfRef.current?.focus();
  };

  const alleFirmenIds = [...p.firmen.map((f) => f.id), FIRMA_OHNE];

  const firmaKlick = (id: string, nurDiese: boolean) => {
    const aktuell = filter.firmen.length === 0 ? alleFirmenIds : filter.firmen;
    let neu = naechsteAuswahl(aktuell, id, nurDiese);
    // Alle gewählt (oder keine mehr) heißt: kein Firmenfilter.
    if (neu.length === 0 || gleicheMenge(neu, alleFirmenIds)) neu = [];
    setzeFilter({ firmen: neu });
  };

  const firmaAktiv = (id: string) => filter.firmen.length === 0 || filter.firmen.includes(id);

  const istStandard = istStandardFilter(filter);
  const wartetFarbe = WARTET_FARBE[thema];
  const weitereAktiv = weitereFilterAktiv(filter);
  /** Auf dem Desktop: Beschriftung, die in der knappen Stufe nur Screenreader hören. */
  const knappSr = mobil ? undefined : KNAPP_SR;

  const firmenChips: Array<{ id: string; firma: Firma | null; name: string }> = [
    ...p.firmen.map((f) => ({ id: f.id, firma: f, name: f.name })),
    { id: FIRMA_OHNE, firma: null, name: "Ohne Firma" },
  ];

  /* ── Bausteine ── */

  const statusGruppe = (
    <div
      role="group"
      aria-label="Status"
      // Desktop: die Chips fließen direkt in der Leiste, so teilt sich der letzte Status
      // eine Zeile mit „Wartet“ und „Filter“ (eine Zeile weniger bei offenem Panel).
      className={mobil ? "flex shrink-0 items-center gap-1" : "contents"}
    >
      {KARTEN_STATUS_REIHENFOLGE.map((s) => {
        const aktiv = filter.status.includes(s);
        const stil = STATUS_STIL[s];
        return (
          <button
            key={s}
            type="button"
            aria-pressed={aktiv}
            title={`${stil.label}. Klick: ein/aus, Alt+Klick: nur dieser Status`}
            onClick={(e) => setzeFilter({ status: naechsteAuswahl(filter.status, s, e.altKey) })}
            className={CHIP}
            style={{
              borderColor: aktiv ? "var(--lk-panel-rand)" : "transparent",
              background: aktiv ? "var(--lk-panel-2)" : "transparent",
              color: aktiv ? "var(--lk-text)" : "var(--lk-text-schwach)",
            }}
          >
            <StatusForm status={s} thema={thema} groesse={14} className={aktiv ? undefined : "opacity-45 grayscale"} />
            <span className={knappSr}>{stil.kurz}</span>
            <Zahl n={p.statusZahlen[s] ?? 0} aktiv={aktiv} />
          </button>
        );
      })}
    </div>
  );

  // „Wartet“ ist ein Overlay, kein Status: eigener Chip neben den Status-Chips.
  const wartetChip = (
    <button
      type="button"
      aria-pressed={filter.nurWartet}
      title="Nur Leads, die auf uns warten"
      onClick={() => setzeFilter({ nurWartet: !filter.nurWartet })}
      className={CHIP}
      style={{
        borderColor: filter.nurWartet ? wartetFarbe : "transparent",
        background: filter.nurWartet ? `color-mix(in oklab, ${wartetFarbe} 12%, transparent)` : "transparent",
        color: filter.nurWartet ? wartetFarbe : "var(--lk-text-leise)",
      }}
    >
      <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true" style={{ flex: "none" }}>
        <circle cx={7} cy={7} r={5.2} fill="none" stroke={wartetFarbe} strokeWidth={2} />
      </svg>
      <span className={knappSr}>Wartet</span>
    </button>
  );

  const firmenGruppe = (inPopover: boolean, ersterFokus = false) => (
    <div
      role="group"
      aria-label="Firma"
      className={mobil && !inPopover ? "flex shrink-0 items-center gap-1" : cn("flex flex-wrap items-center gap-1", !inPopover && "justify-center")}
    >
      {firmenChips.map((c, i) => {
        const aktiv = firmaAktiv(c.id);
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={aktiv}
            title={`${c.name}. Klick: ein/aus, Alt+Klick: nur diese Firma`}
            onClick={(e) => firmaKlick(c.id, e.altKey)}
            data-erster-fokus={ersterFokus && i === 0 ? "" : undefined}
            className={CHIP}
            style={{
              borderColor: aktiv ? "var(--lk-panel-rand)" : "transparent",
              background: aktiv ? "var(--lk-panel-2)" : "transparent",
              color: aktiv ? "var(--lk-text)" : "var(--lk-text-schwach)",
            }}
          >
            <span className={aktiv ? undefined : "opacity-45 grayscale"}>
              <FirmenBadge firma={c.firma} />
            </span>
            {c.name}
            <Zahl n={p.firmenZahlen[c.id] ?? 0} aktiv={aktiv} />
          </button>
        );
      })}
    </div>
  );

  // Rand als Innenschatten: die Knöpfe füllen die Höhe ohne Rand genau aus (h-9 = 2 + 32 + 2, mobil 2 + 44 + 2).
  const zeitraumSegment = (mitLabel: boolean) => (
    <div
      role="radiogroup"
      aria-label="Eingang"
      className="inline-flex h-9 shrink-0 items-center rounded-full p-0.5 max-lg:h-12"
      style={{ background: "var(--lk-panel-2)", boxShadow: "inset 0 0 0 1px var(--lk-panel-rand)" }}
    >
      {mitLabel && (
        <span className="k-label pr-1 pl-2.5" style={{ color: "var(--lk-text-schwach)" }} aria-hidden="true">
          Eingang
        </span>
      )}
      {ZEITRAEUME.map((z) => {
        const aktiv = filter.zeitraum === z.wert;
        return (
          <button
            key={z.wert}
            type="button"
            role="radio"
            aria-checked={aktiv}
            title={z.title}
            onClick={() => setzeFilter({ zeitraum: z.wert })}
            className={cn(
              "inline-flex h-8 items-center rounded-full px-2.5 text-[12.5px] font-medium whitespace-nowrap tabular-nums transition-colors max-lg:h-11 max-lg:min-w-11 max-lg:justify-center max-lg:px-3",
              aktiv
                ? "bg-[var(--lk-panel)] text-[var(--lk-text)] shadow-[0_1px_2px_rgba(0,0,0,0.12)]"
                : "text-[var(--lk-text-leise)] hover:text-[var(--lk-text)]",
              FOKUS,
            )}
          >
            {z.label}
          </button>
        );
      })}
    </div>
  );

  const wertKnopf = (
    <button
      ref={wertKnopfRef}
      type="button"
      aria-haspopup="dialog"
      aria-expanded={wertOffen}
      aria-controls={wertOffen ? wertId : undefined}
      onClick={() => {
        setMehrOffen(false);
        setWertOffen((o) => !o);
      }}
      className={CHIP}
      style={{
        borderColor: filter.wertAbEuro !== null ? "var(--lk-akzent)" : "var(--lk-panel-rand)",
        background: filter.wertAbEuro !== null || wertOffen ? "var(--lk-aktiv)" : "transparent",
        color: "var(--lk-text)",
      }}
    >
      <Euro className="size-3.5" aria-hidden="true" style={{ color: "var(--lk-text-leise)" }} />
      {filter.wertAbEuro === null ? "Wert ab" : `ab ${EURO.format(filter.wertAbEuro)} €`}
    </button>
  );

  const mehrKnopf = (
    <button
      ref={mehrKnopfRef}
      type="button"
      aria-haspopup="dialog"
      aria-expanded={mehrOffen}
      aria-controls={mehrOffen ? mehrId : undefined}
      title="Firma, Eingang und Wert"
      onClick={() => {
        setWertOffen(false);
        setMehrOffen((o) => !o);
      }}
      className={CHIP}
      style={{
        borderColor: weitereAktiv > 0 ? "var(--lk-akzent)" : "var(--lk-panel-rand)",
        background: weitereAktiv > 0 || mehrOffen ? "var(--lk-aktiv)" : "transparent",
        color: "var(--lk-text)",
      }}
    >
      <ListFilter className="size-3.5" aria-hidden="true" style={{ color: "var(--lk-text-leise)" }} />
      Filter
      {weitereAktiv > 0 && (
        <span
          className="k-mono inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] text-white"
          style={{ background: "var(--lk-akzent)" }}
          aria-hidden="true"
        >
          {weitereAktiv}
        </span>
      )}
      <span className="sr-only">
        : Firma, Eingang, Wert{weitereAktiv > 0 ? `, ${weitereAktiv} aktiv` : ""}
      </span>
    </button>
  );

  const zuruecksetzenKnopf = !istStandard && (
    <button
      type="button"
      title="Filter zurücksetzen"
      onClick={() => {
        setWertOffen(false);
        setMehrOffen(false);
        p.zuruecksetzen();
      }}
      className={CHIP}
      style={{ borderColor: "transparent", color: "var(--lk-akzent)" }}
    >
      <RotateCcw className="size-3.5" aria-hidden="true" />
      <span className={knappSr}>Filter zurücksetzen</span>
    </button>
  );

  const trefferText = (kurzMoeglich: boolean) => (
    <>
      <strong className="font-semibold" style={{ color: "var(--lk-text)" }}>
        {p.trefferGesamt}
      </strong>
      {p.trefferGesamt === 1 ? "Lead" : "Leads"}
      <span className={cn("inline-flex items-center gap-1.5", kurzMoeglich && NUR_VOLL)}>
        <span aria-hidden="true" style={{ color: "var(--lk-text-schwach)" }}>
          ·
        </span>
        {p.trefferMitOrt} auf der Karte
      </span>
    </>
  );

  const treffer = (
    <span
      aria-live="polite"
      title={`${p.trefferMitOrt} auf der Karte`}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 pr-1 pl-1 text-[12.5px] whitespace-nowrap tabular-nums max-lg:h-11"
      style={{ color: "var(--lk-text-leise)" }}
    >
      {trefferText(!mobil)}
    </span>
  );

  const wertPopover = wertOffen && (
    <Popover
      id={wertId}
      titel="Wert ab"
      ariaLabel="Wert ab"
      schliessen={wertSchliessen}
      className="right-2 left-2 @min-[48rem]:left-auto @min-[48rem]:w-72"
    >
      <div className="mt-2">
        <WertFormular
          id={wertId}
          wertAbEuro={filter.wertAbEuro}
          setzen={(euro) => setzeFilter({ wertAbEuro: euro })}
          nachAuswahl={wertSchliessen}
          autoFokus
        />
      </div>
    </Popover>
  );

  /* ── Mobil: einzeilige Scroll-Leiste ── */
  if (mobil) {
    return (
      <div ref={wurzelRef} className="lk-glas relative px-2 py-1.5" aria-label="Legende und Filter">
        <div
          ref={zeileRef}
          className="-m-1 flex items-center gap-1.5 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={randMaske(kanten.links, kanten.rechts)}
          data-rand-links={kanten.links || undefined}
          data-rand-rechts={kanten.rechts || undefined}
        >
          {statusGruppe}
          {wartetChip}
          <Trenner />
          {firmenGruppe(false)}
          <Trenner />
          {zeitraumSegment(true)}
          {wertKnopf}
          {zuruecksetzenKnopf}
          <Trenner />
          {treffer}
        </div>
        {wertPopover}
      </div>
    );
  }

  /* ── Desktop: umbrechend, Stufen nach Containerbreite ── */
  return (
    <div ref={wurzelRef} className="lk-glas relative px-3 py-2 @max-[14rem]:hidden" aria-label="Legende und Filter">
      {/* Ohne Trennstriche: beim Umbrechen stünden sie am Zeilenende. Gruppen trennt ein Abstand. */}
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {statusGruppe}
        <div className="contents [&>*]:ml-1.5">{wartetChip}</div>
        {/* Volle Leiste: Firma, Eingang und Wert direkt */}
        <div className={cn("contents [&>[role=group]]:ml-1.5 [&>[role=radiogroup]]:ml-1.5", NUR_VOLL)}>
          {firmenGruppe(false)}
          {zeitraumSegment(true)}
          {wertKnopf}
        </div>
        {/* Schmaler: dieselben Filter hinter dem Knopf „Filter (n)“ */}
        <div className="hidden @max-[48rem]:contents">{mehrKnopf}</div>
        {zuruecksetzenKnopf}
        <div className="contents [&>*]:ml-1">{treffer}</div>
      </div>

      {wertPopover}

      {mehrOffen && (
        <div ref={mehrRef} className="contents">
          <Popover
            id={mehrId}
            titel="Weitere Filter"
            ariaLabel="Weitere Filter: Firma, Eingang, Wert"
            schliessen={mehrSchliessen}
            className="right-0 left-0 mx-auto max-h-[min(70vh,36rem)] max-w-md overflow-y-auto"
          >
            <p className="k-label mt-2 mb-1.5" style={{ color: "var(--lk-text-schwach)" }} aria-hidden="true">
              Firma
            </p>
            {firmenGruppe(true, true)}
            <p className="k-label mt-3 mb-1.5" style={{ color: "var(--lk-text-schwach)" }} aria-hidden="true">
              Eingang
            </p>
            {zeitraumSegment(false)}
            <p className="k-label mt-3 mb-1.5" style={{ color: "var(--lk-text-schwach)" }} aria-hidden="true">
              Wert ab
            </p>
            <WertFormular
              id={`${mehrId}-wert`}
              wertAbEuro={filter.wertAbEuro}
              setzen={(euro) => setzeFilter({ wertAbEuro: euro })}
              autoFokus={false}
            />
            {/* Wirkung sofort sichtbar; Zurücksetzen steht unter dem Popover in der Leiste. */}
            <p
              className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-2.5 text-[12.5px] whitespace-nowrap tabular-nums"
              style={{ borderColor: "var(--lk-panel-rand)", color: "var(--lk-text-leise)" }}
            >
              {trefferText(false)}
            </p>
          </Popover>
        </div>
      )}
    </div>
  );
}

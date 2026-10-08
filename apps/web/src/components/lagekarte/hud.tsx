"use client";
/**
 * Lagekarte: Lage-HUD. Schwebt oben über der Karte. Links Titel und Stand,
 * in der Mitte die Kennzahlen als Kacheln, rechts die Schalter (Karte/Liste,
 * 2D/3D, Kamera). Schmal bleibt nur die scrollbare Kennzahl-Leiste, die
 * Schalter wandern in ein kleines Menü.
 *
 * Breiten über Container-Queries: der Container setzt `@container` auf den
 * HUD-Rahmen. Maßgeblich ist der Platz für das HUD (Seitenleiste der App,
 * Fensterbreite), nicht die Fensterbreite allein.
 *
 * Der Umschalter „Karte | Liste“ (zur klassischen Startseite) steht immer mit
 * Text da, sobald das HUD ihn neben den Kennzahlen unterbringt (ab 928 px
 * HUD-Breite, Spec 8: „gut sichtbar“); nur schmaler (Handy, kleines Tablet)
 * steckt er im Menü. Platz dafür: Kamera-Knöpfe nur als Icon (Text erst ab
 * 1440 px), Titel „Lage“ erst ab @7xl, Kachel „Verortet“ zwischen 1100 und
 * 1160 px ausgeblendet (dieselbe Zahl steht in der Legende und im Tab „Ohne Ort“).
 */
import { useEffect, useId, useRef, useState } from "react";
import { format, isValid } from "date-fns";
import { de } from "date-fns/locale";
import { AlertTriangle, Box, Crosshair, List, Map as MapIcon, SlidersHorizontal, Square } from "lucide-react";
import type { Kennzahlen } from "@/lib/lagekarte/typen";
import { euroAusCent } from "@/lib/lagekarte/farben";
import { cn } from "@/lib/utils";

export interface HudProps {
  kennzahlen: Kennzahlen;
  /** ISO-Zeitpunkt der Berechnung (LagekarteAntwort.stand). */
  stand: string;
  aktualisiertFehler: boolean;
  ansicht: "2d" | "3d";
  onAnsicht: (a: "2d" | "3d") => void;
  /** Zur klassischen Startseite. */
  onListe: () => void;
  onKamera: (z: "kern" | "bw") => void;
  /** Öffnet den Tab „Wartet“ in der Leiste, setzt nurWartet nicht. */
  onWartetKlick: () => void;
  /** Vorschau mit erfundenen Daten (nur Entwicklung): kleines Etikett am HUD. */
  vorschau?: boolean;
}

const FOKUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lk-akzent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--lk-panel)]";

const KNOPF =
  "inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium whitespace-nowrap transition-colors " +
  "text-[var(--lk-text-leise)] hover:bg-[var(--lk-hover)] hover:text-[var(--lk-text)] " +
  FOKUS;

function mehrzahl(n: number, einzahl: string, mehrzahl: string): string {
  return `${n} ${n === 1 ? einzahl : mehrzahl}`;
}

/** „Okt.“ aus „2026-10“; bei unerwartetem Format bleibt der Rohwert. */
function monatKurz(monat: string): string {
  const d = new Date(`${monat}-01T12:00:00`);
  return isValid(d) ? format(d, "MMM", { locale: de }) : monat;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="k-label block" style={{ color: "var(--lk-text-schwach)" }}>
      {children}
    </span>
  );
}

interface KachelProps {
  label: string;
  wert: React.ReactNode;
  unterzeile?: string;
  akzent?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
  className?: string;
}

function Kachel({ label, wert, unterzeile, akzent = false, onClick, ariaLabel, className }: KachelProps) {
  const inhalt = (
    <>
      <Label>{label}</Label>
      <span
        className="k-display mt-0.5 block text-[26px] leading-none tabular-nums @3xl:text-[28px]"
        style={{ color: akzent ? "var(--lk-wartet)" : "var(--lk-text)" }}
      >
        {wert}
      </span>
      {unterzeile && (
        <span className="mt-1 block truncate text-[11.5px] leading-tight" style={{ color: "var(--lk-text-leise)" }}>
          {unterzeile}
        </span>
      )}
    </>
  );
  const basis = cn("relative min-w-[108px] shrink-0 snap-start rounded-xl px-3 py-2 text-left", className);
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        className={cn(basis, "cursor-pointer transition-colors hover:bg-[var(--lk-hover)] active:bg-[var(--lk-aktiv)]", FOKUS)}
      >
        {akzent && (
          <span
            aria-hidden="true"
            className="absolute top-2.5 right-2.5 h-2 w-2 rounded-full"
            style={{ background: "var(--lk-wartet)" }}
          />
        )}
        {inhalt}
      </button>
    );
  }
  return <div className={basis}>{inhalt}</div>;
}

function Segment({
  label,
  kinder,
}: {
  label: string;
  kinder: Array<{ key: string; inhalt: React.ReactNode; aktiv: boolean; onClick: () => void; title?: string; ariaLabel?: string }>;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex h-9 items-center rounded-full border p-0.5"
      style={{ background: "var(--lk-panel-2)", borderColor: "var(--lk-panel-rand)" }}
    >
      {kinder.map((k) => (
        <button
          key={k.key}
          type="button"
          aria-pressed={k.aktiv}
          aria-label={k.ariaLabel}
          title={k.title}
          onClick={k.onClick}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium whitespace-nowrap transition-colors",
            k.aktiv
              ? "bg-[var(--lk-panel)] text-[var(--lk-text)] shadow-[0_1px_2px_rgba(0,0,0,0.12)]"
              : "text-[var(--lk-text-leise)] hover:text-[var(--lk-text)]",
            FOKUS,
          )}
        >
          {k.inhalt}
        </button>
      ))}
    </div>
  );
}

/** Karte | Liste: Wechsel zur klassischen Startseite, immer mit Text (Spec 8). */
function AnsichtSchalter({ onListe }: Pick<HudProps, "onListe">) {
  return (
    <Segment
      label="Startseite"
      kinder={[
        { key: "karte", inhalt: "Karte", aktiv: true, onClick: () => undefined, title: "Lagekarte (aktuelle Ansicht)" },
        { key: "liste", inhalt: "Liste", aktiv: false, onClick: onListe, title: "Zur klassischen Startseite" },
      ]}
    />
  );
}

/** Schalter als Liste (mobiles Menü). */
function SchalterListe(p: Pick<HudProps, "ansicht" | "onAnsicht" | "onListe" | "onKamera"> & { schliessen: () => void }) {
  const eintrag = (inhalt: React.ReactNode, onClick: () => void, aktiv?: boolean) => (
    <button
      type="button"
      aria-pressed={aktiv}
      onClick={() => {
        onClick();
        p.schliessen();
      }}
      className={cn(
        "flex h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-[13px] font-medium transition-colors hover:bg-[var(--lk-hover)] max-lg:h-11",
        aktiv ? "text-[var(--lk-text)]" : "text-[var(--lk-text-leise)]",
        FOKUS,
      )}
    >
      {inhalt}
      {aktiv && (
        <span className="ml-auto h-1.5 w-1.5 rounded-full" style={{ background: "var(--lk-akzent)" }} aria-hidden="true" />
      )}
    </button>
  );
  return (
    <div role="group" aria-label="Ansicht und Kamera" className="flex flex-col gap-0.5">
      {eintrag(
        <>
          <List className="size-4" aria-hidden="true" /> Listenansicht
        </>,
        p.onListe,
      )}
      <div className="my-1 h-px" style={{ background: "var(--lk-panel-rand)" }} aria-hidden="true" />
      {eintrag(
        <>
          <Square className="size-4" aria-hidden="true" /> 2D flach
        </>,
        () => p.onAnsicht("2d"),
        p.ansicht === "2d",
      )}
      {eintrag(
        <>
          <Box className="size-4" aria-hidden="true" /> 3D mit Türmen
        </>,
        () => p.onAnsicht("3d"),
        p.ansicht === "3d",
      )}
      <div className="my-1 h-px" style={{ background: "var(--lk-panel-rand)" }} aria-hidden="true" />
      {eintrag(
        <>
          <Crosshair className="size-4" aria-hidden="true" /> Kerngebiet
        </>,
        () => p.onKamera("kern"),
      )}
      {eintrag(
        <>
          <MapIcon className="size-4" aria-hidden="true" /> Ganz BW
        </>,
        () => p.onKamera("bw"),
      )}
    </div>
  );
}

export default function Hud(p: HudProps) {
  const { kennzahlen: k, stand, aktualisiertFehler } = p;
  const [menueOffen, setMenueOffen] = useState(false);
  const menueRef = useRef<HTMLDivElement>(null);
  const menueId = useId();

  useEffect(() => {
    if (!menueOffen) return;
    const aufKlick = (e: MouseEvent | TouchEvent) => {
      if (menueRef.current && !menueRef.current.contains(e.target as Node)) setMenueOffen(false);
    };
    const aufTaste = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenueOffen(false);
    };
    document.addEventListener("mousedown", aufKlick);
    document.addEventListener("touchstart", aufKlick);
    document.addEventListener("keydown", aufTaste);
    return () => {
      document.removeEventListener("mousedown", aufKlick);
      document.removeEventListener("touchstart", aufKlick);
      document.removeEventListener("keydown", aufTaste);
    };
  }, [menueOffen]);

  const standDatum = new Date(stand);
  const standGueltig = isValid(standDatum);
  const datumText = standGueltig ? format(standDatum, "EEEEEE, d. MMM", { locale: de }) : "";
  const standText = standGueltig ? `Stand ${format(standDatum, "HH:mm")}` : "Stand unbekannt";

  const wartetUnterzeile = `${mehrzahl(k.wartet.antwort, "Antwort", "Antworten")} · ${k.wartet.neuPruefen} neue`;
  const angenommenLabel = `Angenommen ${monatKurz(k.angenommenMonat.monat)}`;

  const standZeile = (
    <span
      role={aktualisiertFehler ? "alert" : "status"}
      className="k-mono inline-flex items-center gap-1 text-[11px] tracking-wide whitespace-nowrap"
      style={{ color: aktualisiertFehler ? "var(--lk-wartet)" : "var(--lk-text-schwach)" }}
    >
      {aktualisiertFehler ? (
        <>
          <AlertTriangle className="size-3" aria-hidden="true" />
          Aktualisierung fehlgeschlagen
        </>
      ) : (
        standText
      )}
    </span>
  );

  return (
    <header
      aria-label="Lage-HUD"
      className="lk-glas relative flex items-stretch gap-2 px-2 py-1.5 @min-[68.75rem]:items-center @min-[68.75rem]:gap-4 @min-[68.75rem]:px-4 @min-[68.75rem]:py-2"
    >
      {/* Vorschau: Etikett auf der Oberkante, kostet keinen Platz und ist in jeder Breite sichtbar. */}
      {p.vorschau && (
        <span
          className="k-mono pointer-events-none absolute -top-2 left-4 z-10 rounded-full px-2 text-[10px] leading-4 font-medium tracking-wide whitespace-nowrap"
          style={{ background: "var(--lk-akzent)", color: "var(--lk-panel)" }}
          data-testid="vorschau-etikett"
        >
          Vorschau mit Beispieldaten
        </span>
      )}
      {/* Links: Titel, Datum, Stand (ab 1100 px HUD-Breite; die Kacheln brauchen ~700 px, die Schalter ~290 px) */}
      <div className="hidden shrink-0 @min-[68.75rem]:flex @min-[68.75rem]:items-baseline @min-[68.75rem]:gap-3">
        {/* Unter @7xl nur für Screenreader: der Platz gehört dann Kennzahlen und „Karte | Liste“. */}
        <h1 className="k-display sr-only text-[30px] leading-none @7xl:not-sr-only" style={{ color: "var(--lk-text)" }}>
          Lage
        </h1>
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] leading-tight font-medium" style={{ color: "var(--lk-text-leise)" }}>
            {datumText}
          </span>
          {standZeile}
        </div>
      </div>

      {/* Mitte: Kennzahlen, mobil als Scroll-Leiste */}
      <div
        className="-m-1 flex min-w-0 flex-1 snap-x snap-mandatory items-stretch gap-1 overflow-x-auto p-1 [scrollbar-width:none] justify-center-safe @min-[68.75rem]:snap-none [&::-webkit-scrollbar]:hidden"
        aria-label="Kennzahlen"
      >
        <Kachel
          label="Wartet"
          wert={k.wartet.gesamt}
          unterzeile={wartetUnterzeile}
          akzent={k.wartet.gesamt > 0}
          onClick={p.onWartetKlick}
          ariaLabel={`Wartet: ${k.wartet.gesamt}, ${wartetUnterzeile}. Liste öffnen`}
        />
        <Kachel
          label="Angebote offen"
          wert={k.angeboteOffen.anzahl}
          unterzeile={`${k.angeboteOffen.ungesehen} ungesehen`}
        />
        <Kachel
          label={angenommenLabel}
          wert={euroAusCent(k.angenommenMonat.cent)}
          unterzeile={mehrzahl(k.angenommenMonat.anzahl, "KV", "KVs")}
        />
        <Kachel label="Umzüge 7 Tage" wert={k.umzuegeNaechste7Tage} />
        <Kachel
          label="Verortet"
          className="@min-[68.75rem]:@max-[72.5rem]:hidden"
          wert={
            <>
              {k.verortet.mitOrt}
              <span className="ml-1 text-[13px]" style={{ color: "var(--lk-text-schwach)" }}>
                von {k.verortet.gesamt}
              </span>
            </>
          }
        />
      </div>

      {/* Rechts: Schalter (ab 1100 px HUD-Breite). „Karte | Liste“ immer mit Text, Kamera erst ab 1440 px. */}
      <div className="hidden shrink-0 items-center gap-2 @min-[68.75rem]:flex">
        <AnsichtSchalter onListe={p.onListe} />
        <Segment
          label="Darstellung"
          kinder={[
            { key: "2d", inhalt: "2D", aktiv: p.ansicht === "2d", onClick: () => p.onAnsicht("2d"), title: "Flaches Spielbrett" },
            {
              key: "3d",
              inhalt: (
                <>
                  <Box className="size-3.5" aria-hidden="true" /> 3D
                </>
              ),
              aktiv: p.ansicht === "3d",
              onClick: () => p.onAnsicht("3d"),
              title: "Geneigt mit Auftrags-Türmen (Taste 3)",
            },
          ]}
        />
        <div
          role="group"
          aria-label="Kamera"
          className="inline-flex h-9 items-center rounded-full border p-0.5"
          style={{ borderColor: "var(--lk-panel-rand)" }}
        >
          <button type="button" onClick={() => p.onKamera("kern")} className={cn(KNOPF, "h-8")} title="Kamera auf das Kerngebiet" aria-label="Kerngebiet">
            <Crosshair className="size-3.5" aria-hidden="true" /> <span className="hidden @min-[90rem]:inline">Kerngebiet</span>
          </button>
          <button type="button" onClick={() => p.onKamera("bw")} className={cn(KNOPF, "h-8")} title="Kamera auf ganz Baden-Württemberg" aria-label="Ganz BW">
            <MapIcon className="size-3.5" aria-hidden="true" /> <span className="hidden @min-[90rem]:inline">Ganz BW</span>
          </button>
        </div>
      </div>

      {/* Kompakt, aber breit genug (z. B. 1280-px-Fenster): „Karte | Liste“ sichtbar neben dem Menü. */}
      <div className="hidden shrink-0 items-center @min-[58rem]:flex @min-[68.75rem]:hidden">
        <AnsichtSchalter onListe={p.onListe} />
      </div>

      {/* Schmal: kleines Menü mit den Schaltern (44 px Trefferfläche, einziger mobiler Weg zu 2D/3D und Kamera) */}
      <div ref={menueRef} className="relative flex shrink-0 items-center @min-[68.75rem]:hidden">
        <button
          type="button"
          aria-expanded={menueOffen}
          aria-controls={menueId}
          aria-label={aktualisiertFehler ? "Ansicht und Kamera. Aktualisierung fehlgeschlagen" : "Ansicht und Kamera"}
          onClick={() => setMenueOffen((o) => !o)}
          className={cn(
            "relative inline-flex size-11 items-center justify-center rounded-full transition-colors hover:bg-[var(--lk-hover)]",
            menueOffen && "bg-[var(--lk-aktiv)]",
            FOKUS,
          )}
          style={{ color: "var(--lk-text)" }}
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          {aktualisiertFehler && (
            <span aria-hidden="true" className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full" style={{ background: "var(--lk-wartet)" }} />
          )}
        </button>
        {menueOffen && (
          <div
            id={menueId}
            className="lk-glas absolute top-full right-0 z-20 mt-2 w-56 p-1.5"
            // Deckend: das HUD selbst ist Backdrop-Root (backdrop-filter), der Weichzeichner des
            // Menüs sähe die Karte nicht und sie schiene scharf durch.
            style={{ background: "var(--lk-panel)" }}
          >
            <div className="flex flex-col gap-0.5 px-3 pt-1.5 pb-2">
              <span className="text-[13px] leading-tight font-medium" style={{ color: "var(--lk-text)" }}>
                {datumText || "Lage"}
              </span>
              {standZeile}
            </div>
            <SchalterListe
              ansicht={p.ansicht}
              onAnsicht={p.onAnsicht}
              onListe={p.onListe}
              onKamera={p.onKamera}
              schliessen={() => setMenueOffen(false)}
            />
          </div>
        )}
      </div>
    </header>
  );
}

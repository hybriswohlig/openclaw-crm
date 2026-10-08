"use client";
/**
 * Lagekarte: Quellenvermerk der Karte. dl-de/by-2-0 verlangt einen erkennbaren
 * Vermerk, deshalb steht die Kurzzeile immer sichtbar direkt unter dem HUD (in
 * dem Streifen, den Leiste, Panel und Sheet freilassen; der Container misst ihre
 * Höhe und setzt alles andere darunter). Der ausführliche Text (Datensatz,
 * Lizenzen, Schrift) klappt per Knopf auf.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Info } from "lucide-react";

export const QUELLE_KURZ = "© BKG 2026, dl-de/by-2-0 (verändert) · PLZ: GeoNames CC BY 4.0";

const LINK =
  "underline decoration-[var(--lk-panel-rand)] underline-offset-2 hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lk-akzent)]";

export default function Quellenangabe({ zeileRef }: { zeileRef?: (el: HTMLElement | null) => void }) {
  const [offen, setOffen] = useState(false);
  const wurzelRef = useRef<HTMLDivElement>(null);
  const textId = useId();

  // Klick daneben schließt den ausführlichen Text.
  useEffect(() => {
    if (!offen) return;
    const aufKlick = (e: MouseEvent | TouchEvent) => {
      if (wurzelRef.current && !wurzelRef.current.contains(e.target as Node)) setOffen(false);
    };
    document.addEventListener("mousedown", aufKlick);
    document.addEventListener("touchstart", aufKlick);
    return () => {
      document.removeEventListener("mousedown", aufKlick);
      document.removeEventListener("touchstart", aufKlick);
    };
  }, [offen]);

  return (
    <div
      ref={wurzelRef}
      className="flex flex-col items-end"
      onKeyDown={(e) => {
        // Esc schließt nur den Text, nicht das Lead-Panel (das prüft defaultPrevented).
        if (e.key === "Escape" && offen) {
          e.preventDefault();
          setOffen(false);
        }
      }}
    >
      {/* Nie abgeschnitten: schmaler als die Zeile bricht der Text um, der Container misst die Höhe. */}
      <p
        ref={zeileRef}
        className="lk-quelle inline-flex max-w-full items-center gap-1 rounded-[9px] py-px pr-0.5 pl-2 text-[10px] leading-4 sm:text-[10.5px]"
        data-testid="quellenangabe"
      >
        <span className="min-w-0">{QUELLE_KURZ}</span>
        <button
          type="button"
          aria-expanded={offen}
          aria-controls={textId}
          aria-label="Quellenangaben ausführlich"
          title="Quellenangaben ausführlich"
          onClick={() => setOffen((o) => !o)}
          className="relative inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[var(--lk-text-leise)] hover:text-[var(--lk-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--lk-akzent)] after:absolute after:-inset-3 after:content-['']"
        >
          <Info className="size-3.5" aria-hidden="true" />
        </button>
      </p>
      {offen && (
        <div
          id={textId}
          className="lk-glas mt-1.5 w-[min(380px,calc(100vw-24px))] px-3.5 py-3 text-[12px] leading-snug"
          // Deckend: Text über Karte, Leiste oder Panel muss lesbar bleiben.
          style={{ background: "var(--lk-panel)", color: "var(--lk-text-leise)", borderRadius: 12 }}
        >
          <p className="k-label mb-1.5" style={{ color: "var(--lk-text-schwach)" }}>
            Quellen der Karte
          </p>
          <ul className="space-y-1.5">
            <li>
              Kreis- und Landesgrenzen: Verwaltungsgebiete 1:1 000 000 (VG1000), © GeoBasis-DE / BKG 2026,{" "}
              <a className={LINK} href="https://www.govdata.de/dl-de/by-2-0" target="_blank" rel="noopener noreferrer">
                Datenlizenz Deutschland Namensnennung 2.0
              </a>
              . Daten verändert: vereinfacht und als Spielbrett dargestellt.
            </li>
            <li>
              PLZ-Schwerpunkte: GeoNames,{" "}
              <a className={LINK} href="https://creativecommons.org/licenses/by/4.0/deed.de" target="_blank" rel="noopener noreferrer">
                CC BY 4.0
              </a>
              . Positionen sind PLZ-Gebiete, keine Adressen.
            </li>
            <li>
              Schrift der Kartenbeschriftung: Noto Sans,{" "}
              <a className={LINK} href="https://openfontlicense.org" target="_blank" rel="noopener noreferrer">
                SIL Open Font License 1.1
              </a>
              .
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { GlassButton } from "@/components/glassyui/glass-button";
import type { LeadKarte as Karte, LeadsBoard as Board, LeadsChips, LeadsFilter } from "@/lib/leads-board";
import { KarteInhalt } from "./lead-karte";
import { LeadsChipsZeile } from "./leads-chips";
import { NEUER_LEAD_URL } from "./leads-kopf";
import { LeadsLeiste } from "./leads-leiste";
import { handyUnterzeile, leerText, sichtbareSpalten } from "./leads-logik";

export type HandyZustand = { art: "laden" } | { art: "fehler"; meldung: string } | { art: "fertig"; board: Board };

/**
 * Unter 1024 px (Entscheidung 17): Kartenliste in Board-Reihenfolge über alle
 * sichtbaren Spalten, Stufe als Pille auf der Karte; Kopf mit „{n} warten auf
 * uns“, Chips einzeilig scrollbar, Leiste ohne Umschalter. Kein Ziehen, kein
 * Stufenmenü (Stufe wechselt in der Akte).
 */
export function LeadsHandy({
  zustand,
  chips,
  filter,
  nachladend,
  mehrGesperrt,
  onFilter,
  onMehr,
  onErneut,
  onOeffnen,
  onZahlungGemeldet,
}: {
  zustand: HandyZustand;
  chips: LeadsChips | null;
  filter: LeadsFilter;
  nachladend: ReadonlySet<string>;
  /** Lädt gerade neu: „Mehr laden“ aus. */
  mehrGesperrt: boolean;
  onFilter: (teil: Partial<LeadsFilter>) => void;
  onMehr: (stufeId: string) => void;
  onErneut: () => void;
  onOeffnen: (karte: Karte) => void;
  onZahlungGemeldet: (karte: Karte) => void;
}) {
  const board = zustand.art === "fertig" ? zustand.board : null;
  const leer = board ? leerText(board.spalten, filter) : null;

  return (
    <div className="leads leads-handy">
      <header className="leads-handy-kopf">
        <div>
          <h1>Leads</h1>
          <p>{chips ? handyUnterzeile(chips) : "Wird geladen"}</p>
        </div>
        <GlassButton size="sm" asChild>
          <Link href={NEUER_LEAD_URL} aria-label="Neuer Lead">
            +
          </Link>
        </GlassButton>
      </header>
      <LeadsChipsZeile chips={chips} aktiv={filter.chip} kompakt onWaehlen={(chip) => onFilter({ chip })} />
      <LeadsLeiste
        filter={filter}
        modus="board"
        firmen={board?.firmen ?? []}
        quellen={board?.quellen ?? []}
        kompakt
        onFilter={onFilter}
        onModus={() => undefined}
      />

      {zustand.art === "laden" ? (
        <div className="leads-handy-liste" aria-busy="true" aria-label="Leads werden geladen">
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} className="lg-skeleton leads-skelett-karte" />
          ))}
        </div>
      ) : null}

      {zustand.art === "fehler" ? (
        <div className="leads-hinweis" role="alert">
          <p>Leads konnten nicht geladen werden. {zustand.meldung}</p>
          <GlassButton size="sm" onClick={onErneut}>
            Erneut versuchen
          </GlassButton>
        </div>
      ) : null}

      {board && leer ? (
        <div className="leads-hinweis">
          <p>{leer === "keine" ? "Noch keine Leads." : "Keine Treffer für diese Filter."}</p>
          {leer === "treffer" ? (
            <GlassButton size="sm" onClick={() => onFilter({ chip: null, firmaId: null, quelleId: null, monat: null, suche: "", nurWartet: false })}>
              Filter zurücksetzen
            </GlassButton>
          ) : null}
        </div>
      ) : null}

      {board && !leer ? (
        <div className="leads-handy-liste">
          {sichtbareSpalten(board.spalten).map((s) => (
            <section key={s.stufeId} className="leads-handy-gruppe" aria-label={s.label}>
              {s.karten.map((k) => (
                <article key={k.id} className="leads-karte" onClick={(e) => !(e.target as HTMLElement).closest("a, button") && onOeffnen(k)}>
                  <KarteInhalt karte={k} stufePille onZahlungGemeldet={onZahlungGemeldet} />
                </article>
              ))}
              {s.weiter !== null ? (
                <button type="button" className="leads-mehr" disabled={nachladend.has(s.stufeId) || mehrGesperrt} onClick={() => onMehr(s.stufeId)}>
                  {nachladend.has(s.stufeId) ? "Lädt …" : `Mehr aus „${s.label}“ laden (${s.anzahl - s.karten.length} weitere)`}
                </button>
              ) : null}
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}

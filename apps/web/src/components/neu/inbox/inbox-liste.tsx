"use client";

import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import type { InboxEintrag } from "@/lib/inbox-neu";
import { InboxEintragZeile } from "./inbox-eintrag";
import { listenUnterzeile } from "./inbox-logik";

export type ListeZustand = { art: "laden" } | { art: "fehler"; meldung: string } | { art: "fertig" };

/**
 * Das linke Panel „Gespräche“: Hauptgruppe oben, darunter der Trenner
 * „Info und Kein Lead · N“, der die Gruppe auf- und zuklappt (Entscheidung 2).
 * Am Handy (`kompakt`) ohne Panelkopf; die Seite trägt dann den Kopf „Inbox“.
 */
export function InboxListe({
  zustand,
  haupt,
  info,
  anzahl,
  abgeschnitten,
  gesucht,
  gewaehltKey,
  infoOffen,
  kompakt,
  onInfoOffen,
  onWaehlen,
  onErneut,
}: {
  zustand: ListeZustand;
  haupt: InboxEintrag[];
  info: InboxEintrag[];
  /** Alle geladenen Einträge, unabhängig vom Filter. */
  anzahl: number;
  abgeschnitten: boolean;
  /** Serversuche aktiv: Trenner und Gruppen entfallen. */
  gesucht: boolean;
  gewaehltKey: string | null;
  infoOffen: boolean;
  kompakt: boolean;
  onInfoOffen: (offen: boolean) => void;
  onWaehlen: (key: string) => void;
  onErneut: () => void;
}) {
  const leer = zustand.art === "fertig" && haupt.length === 0 && info.length === 0;

  return (
    <GlassPanel variant="panel" className="akte-panel inbox-liste-panel" data-kompakt={kompakt || undefined}>
      {kompakt ? null : (
        <div className="akte-panel-kopf">
          <div>
            <h2 className="akte-panel-titel">Gespräche</h2>
            <p className="akte-panel-unter">
              {zustand.art === "fertig" ? listenUnterzeile(anzahl, abgeschnitten) : "Wird geladen"}
            </p>
          </div>
        </div>
      )}

      <div className="inbox-liste">
        {zustand.art === "laden" ? (
          <ul className="inbox-liste-gruppe" aria-busy="true" aria-label="Gespräche werden geladen">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="inbox-eintrag-skelett">
                <span className="lg-skeleton" data-variant="circle" />
                <span className="lg-skeleton" data-variant="line" />
                <span className="lg-skeleton" data-variant="line" />
              </li>
            ))}
          </ul>
        ) : null}

        {zustand.art === "fehler" ? (
          <div className="inbox-liste-hinweis" role="alert">
            <p>Liste konnte nicht geladen werden. {zustand.meldung}</p>
            <GlassButton size="sm" onClick={onErneut}>
              Erneut laden
            </GlassButton>
          </div>
        ) : null}

        {leer ? (
          <p className="inbox-liste-hinweis">{gesucht ? "Keine Treffer." : anzahl === 0 ? "Noch keine Gespräche." : "Nichts in dieser Auswahl."}</p>
        ) : null}

        {haupt.length > 0 ? (
          <ul className="inbox-liste-gruppe" aria-label={gesucht ? "Treffer" : "Gespräche"}>
            {haupt.map((e) => (
              <InboxEintragZeile key={e.key} e={e} aktiv={e.key === gewaehltKey} kompakt={kompakt} onWaehlen={onWaehlen} />
            ))}
          </ul>
        ) : null}

        {!gesucht && info.length > 0 ? (
          <>
            <button
              type="button"
              className="inbox-trenner"
              aria-expanded={infoOffen}
              onClick={() => onInfoOffen(!infoOffen)}
            >
              <span>Info und Kein Lead · {info.length}</span>
              <svg viewBox="0 0 24 24" aria-hidden="true" data-offen={infoOffen || undefined}>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {infoOffen ? (
              <ul className="inbox-liste-gruppe" aria-label="Info und Kein Lead">
                {info.map((e) => (
                  <InboxEintragZeile key={e.key} e={e} aktiv={e.key === gewaehltKey} kompakt={kompakt} onWaehlen={onWaehlen} />
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </div>
    </GlassPanel>
  );
}

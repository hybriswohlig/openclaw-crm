import { balkenHoehe } from "./uebersicht-logik";

export interface BalkenTeil {
  schluessel: string;
  wert: number;
  /** Klasse für die Farbe aus den Tokens. */
  ton: string;
  titel: string;
}

/**
 * Balken je Monat in HTML und CSS (keine Bibliothek). `gestapelt` legt die
 * Teile übereinander, sonst stehen sie nebeneinander. Werte stehen immer auch
 * als Text in der Tabelle darunter; die Balken sind für Screenreader stumm.
 */
export function Balken({
  monate,
  gestapelt = false,
  beschriftung,
}: {
  monate: { monat: string; label: string; teile: BalkenTeil[] }[];
  gestapelt?: boolean;
  beschriftung: string;
}) {
  const max = Math.max(
    0,
    ...monate.map((m) => (gestapelt ? m.teile.reduce((s, t) => s + Math.max(0, t.wert), 0) : Math.max(0, ...m.teile.map((t) => t.wert)))),
  );
  return (
    <div className="ueb-balken" role="img" aria-label={beschriftung}>
      {monate.map((m) => (
        <div key={m.monat} className="ueb-balken-monat">
          <div className="ueb-balken-flaeche" data-gestapelt={gestapelt || undefined}>
            {m.teile.map((t) => (
              <span
                key={t.schluessel}
                className={`ueb-balken-teil ${t.ton}`}
                style={{ height: `${balkenHoehe(t.wert, max)}%` }}
                title={t.titel}
              />
            ))}
          </div>
          <span className="ueb-balken-label" aria-hidden="true">
            {m.label.split(" ")[0]}
            <span className="ueb-balken-jahr"> {m.label.split(" ")[1] ?? ""}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

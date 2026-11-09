import { GlassPanel } from "@/components/glassyui/glass-panel";
import type { UebersichtAntwort } from "@/lib/einstellungen-uebersicht";
import { balkenHoehe, monatLang, vieleOffen } from "./uebersicht-logik";

/** Abschlussquote je Anlagemonat: Zeile mit Prozent und gewonnen, verloren, offen. */
export function AbschlussBlock({ a }: { a: UebersichtAntwort }) {
  return (
    <GlassPanel variant="panel" className="ueb-block">
      <div className="ueb-block-kopf">
        <h2>Abschlussquote je Monat</h2>
        <p className="ueb-satz">Anteil gewonnener an entschiedenen Anfragen, nach Anlagemonat.</p>
      </div>
      <ol className="ueb-quote">
        {[...a.monate].reverse().map((m) => {
          const q = a.abschluss.je[m] ?? { gewonnen: 0, verloren: 0, offen: 0, quoteProzent: null };
          return (
            <li key={m} className="ueb-quote-zeile">
              <span className="ueb-quote-monat">{monatLang(m)}</span>
              <span className="ueb-quote-balken" aria-hidden="true">
                <span style={{ width: `${balkenHoehe(q.quoteProzent ?? 0, 100)}%` }} />
              </span>
              <b className="ueb-quote-wert">{q.quoteProzent == null ? "–" : `${q.quoteProzent} %`}</b>
              <span className="ueb-quote-zahlen">
                {q.gewonnen} gewonnen, {q.verloren} verloren, {q.offen} offen
                {vieleOffen(q) ? <span className="ueb-marke">noch viele offen</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </GlassPanel>
  );
}

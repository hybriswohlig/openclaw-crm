import { GlassPanel } from "@/components/glassyui/glass-panel";
import type { UebersichtAntwort } from "@/lib/einstellungen-uebersicht";
import { Balken } from "./balken";
import { euro, monatKurz, monatLang } from "./uebersicht-logik";

/** Umsatz je Monat: eingegangen und durchgeführt nebeneinander (G5), mit Tabelle. */
export function UmsatzBlock({ a }: { a: UebersichtAntwort }) {
  return (
    <GlassPanel variant="panel" className="ueb-block">
      <div className="ueb-block-kopf">
        <h2>Umsatz je Monat</h2>
        <p className="ueb-satz">Eingegangen: Zahlungen nach Eingangstag, ohne Kaution. Durchgeführt: Auftragswert im Monat der Durchführung.</p>
        <ul className="ueb-legende" aria-hidden="true">
          <li><span className="ueb-punkt ton-1" />Eingegangen</li>
          <li><span className="ueb-punkt ton-2" />Durchgeführt</li>
        </ul>
      </div>
      <Balken
        beschriftung="Umsatz je Monat als Balken; Werte in der Tabelle"
        monate={a.monate.map((m) => ({
          monat: m,
          label: monatKurz(m),
          teile: [
            { schluessel: "ein", wert: a.eingegangen[m] ?? 0, ton: "ton-1", titel: `Eingegangen ${euro(a.eingegangen[m] ?? 0)}` },
            { schluessel: "durch", wert: a.durchgefuehrt[m]?.cent ?? 0, ton: "ton-2", titel: `Durchgeführt ${euro(a.durchgefuehrt[m]?.cent ?? 0)}` },
          ],
        }))}
      />
      <details className="ueb-details">
        <summary>Tabelle</summary>
        <div className="ueb-tabelle-huelle">
          <table className="ueb-tabelle">
            <thead>
              <tr>
                <th scope="col">Monat</th>
                <th scope="col">Eingegangen</th>
                <th scope="col">Durchgeführt</th>
                <th scope="col">Aufträge</th>
                <th scope="col">ohne Betrag</th>
              </tr>
            </thead>
            <tbody>
              {[...a.monate].reverse().map((m) => (
                <tr key={m}>
                  <th scope="row">{monatLang(m)}</th>
                  <td data-negativ={(a.eingegangen[m] ?? 0) < 0 || undefined}>{euro(a.eingegangen[m] ?? 0)}</td>
                  <td>{euro(a.durchgefuehrt[m]?.cent ?? 0)}</td>
                  <td>{a.durchgefuehrt[m]?.anzahl ?? 0}</td>
                  <td>{a.durchgefuehrt[m]?.ohneBetrag ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </GlassPanel>
  );
}

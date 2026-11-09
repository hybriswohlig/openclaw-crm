import { GlassPanel } from "@/components/glassyui/glass-panel";
import type { UebersichtAntwort } from "@/lib/einstellungen-uebersicht";
import { Balken } from "./balken";
import { monatKurz, monatLang, topQuellen, WEITERE } from "./uebersicht-logik";

const TOENE = ["ton-1", "ton-2", "ton-3", "ton-4", "ton-5"];

/** Anfragen je Monat nach Quelle, gestapelt: fünf häufigste Quellen plus „Weitere“. */
export function AnfragenBlock({ a }: { a: UebersichtAntwort }) {
  const { quellen, weitere } = topQuellen(a.anfragen, 5);
  const mitWeitere = Object.values(weitere).some((n) => n > 0);
  const spalten = [
    ...quellen.map((q, i) => ({ ...q, ton: TOENE[i] })),
    ...(mitWeitere ? [{ id: WEITERE, label: "Weitere", ton: "ton-weitere" }] : []),
  ];
  const wert = (m: string, id: string) => (id === WEITERE ? (weitere[m] ?? 0) : (a.anfragen.je[m]?.[id] ?? 0));
  return (
    <GlassPanel variant="panel" className="ueb-block">
      <div className="ueb-block-kopf">
        <h2>Anfragen je Monat</h2>
        <p className="ueb-satz">Neue Anfragen nach Anlagemonat und Quelle.</p>
        {spalten.length > 0 ? (
          <ul className="ueb-legende" aria-hidden="true">
            {spalten.map((s) => (
              <li key={s.id}>
                <span className={`ueb-punkt ${s.ton}`} />
                {s.label}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <Balken
        gestapelt
        beschriftung="Anfragen je Monat nach Quelle als gestapelte Balken; Werte in der Tabelle"
        monate={a.monate.map((m) => ({
          monat: m,
          label: monatKurz(m),
          teile: spalten.map((s) => ({ schluessel: s.id, wert: wert(m, s.id), ton: s.ton, titel: `${s.label}: ${wert(m, s.id)}` })),
        }))}
      />
      <details className="ueb-details">
        <summary>Tabelle</summary>
        <div className="ueb-tabelle-huelle">
          <table className="ueb-tabelle">
            <thead>
              <tr>
                <th scope="col">Monat</th>
                <th scope="col">Gesamt</th>
                {spalten.map((s) => (
                  <th key={s.id} scope="col">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...a.monate].reverse().map((m) => (
                <tr key={m}>
                  <th scope="row">{monatLang(m)}</th>
                  <td>{a.anfragen.gesamt[m] ?? 0}</td>
                  {spalten.map((s) => (
                    <td key={s.id}>{wert(m, s.id)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </GlassPanel>
  );
}

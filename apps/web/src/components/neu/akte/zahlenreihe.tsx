import { GlassPanel } from "@/components/glassyui/glass-panel";
import type { Kachel } from "@/lib/akte";

/**
 * Die sechs Kacheln der Akte (Kostenvoranschlag, Marge, Termin, Volumen, Team,
 * Wartet), fertig formatiert aus `/akte`. Kachel „Wartet“ trägt ihren Ton
 * (Entscheidung 13) als Punkt in der Pille der Zeile.
 */
export function Zahlenreihe({ kacheln }: { kacheln: Kachel[] }) {
  return (
    <div className="akte-zahlen" role="list" aria-label="Kennzahlen">
      {kacheln.map((k) => (
        <GlassPanel key={k.key} variant="card" className="akte-kachel" role="listitem" data-kachel={k.key}>
          <div className="akte-kachel-label">{k.label}</div>
          <div className="akte-kachel-wert">{k.wert}</div>
          <div className="akte-kachel-zeile">
            {k.ton && k.zeile ? (
              <span className="akte-wartepille">
                <i className="akte-punkt" data-ton={k.ton} aria-hidden="true" />
                <span>{k.zeile}</span>
              </span>
            ) : (
              k.zeile
            )}
          </div>
        </GlassPanel>
      ))}
    </div>
  );
}

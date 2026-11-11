import type { ReactNode } from "react";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { KV_FEHLT_ZEILE, type Kachel } from "@/lib/akte";

/**
 * Die sechs Kacheln der Akte (Kostenvoranschlag, Marge, Termin, Volumen, Team,
 * Wartet), fertig formatiert aus `/akte`. Kachel „Wartet“ trägt ihren Ton
 * (Entscheidung 13) als Punkt in der Pille der Zeile. `kvAktionen` steht in
 * der KV-Kachel, sobald es einen KV gibt (Statuslink, Chat; kv-danach).
 */
export function Zahlenreihe({ kacheln, kvAktionen }: { kacheln: Kachel[]; kvAktionen?: ReactNode }) {
  return (
    <div className="akte-zahlen" role="list" aria-label="Kennzahlen">
      {kacheln.map((k) => (
        <GlassPanel key={k.key} variant="card" className="akte-kachel" role="listitem" data-kachel={k.key}>
          <div className="akte-kachel-label">{k.label}</div>
          <div className="akte-kachel-wert">{k.wert}</div>
          <div className="akte-kachel-zeile">
            {k.ton && k.zeile ? (
              // Die Pille zeigt bis zu zwei Zeilen; der volle Text steht als title.
              <span className="akte-wartepille" title={k.zeile}>
                <i className="akte-punkt" data-ton={k.ton} aria-hidden="true" />
                <span>{k.zeile}</span>
              </span>
            ) : (
              k.zeile
            )}
          </div>
          {k.key === "kv" && kvAktionen && k.zeile !== KV_FEHLT_ZEILE ? kvAktionen : null}
        </GlassPanel>
      ))}
    </div>
  );
}

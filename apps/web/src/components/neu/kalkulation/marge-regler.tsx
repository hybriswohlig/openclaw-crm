"use client";

import { GlassSlider } from "@/components/glassyui/glass-slider";
import type { MargeAnsicht } from "@/lib/kalkulations-ansicht";

/** Position auf der Schiene in Prozent der Breite. */
export function reglerPosition(m: Pick<MargeAnsicht, "min" | "max">, prozent: number): number {
  const spanne = m.max - m.min;
  if (spanne <= 0) return 0;
  return Math.min(100, Math.max(0, ((prozent - m.min) / spanne) * 100));
}

/** Nahe am Rand hängen Marke und Wert nicht über die Schiene hinaus. */
function rand(position: number): "links" | "rechts" | undefined {
  if (position < 12) return "links";
  if (position > 88) return "rechts";
  return undefined;
}

/**
 * Marge-Regler (Spec 3.6): Schiene 30 bis 60, Vorschlagsmarke „Vorschlag N %“
 * in Jade darüber, der gewählte Wert unter dem Knopf, Enden „30 % Untergrenze“
 * und „60 %“. Gesperrt bei gesperrter Version und während eines Laufs.
 */
export function MargeRegler({
  marge,
  wert,
  gesperrt,
  speichert,
  onWert,
}: {
  marge: MargeAnsicht;
  wert: number;
  gesperrt: boolean;
  speichert: boolean;
  onWert: (prozent: number) => void;
}) {
  const wertPos = reglerPosition(marge, wert);
  const vorschlagPos = marge.vorschlagProzent === null ? null : reglerPosition(marge, marge.vorschlagProzent);
  return (
    <>
      <div className="kalk-regler" data-gesperrt={gesperrt ? "" : undefined}>
        {vorschlagPos !== null ? (
          <span className="kalk-regler-marke" style={{ left: `${vorschlagPos}%` }} data-rand={rand(vorschlagPos)} aria-hidden="true">
            Vorschlag {marge.vorschlagProzent} %
          </span>
        ) : null}
        <GlassSlider
          aria-label="Marge in Prozent"
          min={marge.min}
          max={marge.max}
          step={1}
          value={[wert]}
          disabled={gesperrt}
          onValueChange={(v) => {
            const n = v[0];
            if (typeof n === "number") onWert(n);
          }}
        />
        <span className="kalk-regler-wert" style={{ left: `${wertPos}%` }} data-rand={rand(wertPos)} data-speichert={speichert ? "" : undefined} aria-hidden="true">
          {wert} %{speichert ? " …" : ""}
        </span>
      </div>
      <div className="kalk-regler-enden" aria-hidden="true">
        <span>{marge.min} % Untergrenze</span>
        <span>{marge.max} %</span>
      </div>
    </>
  );
}

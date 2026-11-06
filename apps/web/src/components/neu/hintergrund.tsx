import type { ReactNode } from "react";

/**
 * Fläche hinter der neuen Oberfläche über die ganze Seitenhöhe (absolut, nicht fest im
 * Fenster, siehe neu.css): Seitenverlauf, Vermilion-Schleife oben rechts hinter dem Kopf,
 * Silberband unten links am Seitenende (Pfade aus design/neubau-2026-11-05/03-leads-board.html).
 * Die beiden Formen sitzen je in ihrer Ecke, damit sie auch am Handy sichtbar bleiben.
 * `karte` ist der Platz für die blasse Regionskarte späterer Meilensteine.
 */
export function Hintergrund({ karte }: { karte?: ReactNode }) {
  return (
    <div className="neu-hintergrund" aria-hidden="true">
      {karte ? <div className="neu-hintergrund-karte">{karte}</div> : null}

      <svg className="neu-silberband" viewBox="0 880 680 120" preserveAspectRatio="xMinYMax meet">
        <defs>
          <linearGradient id="neu-silber" x2="1" y2=".7">
            <stop stopColor="#d2d5da" />
            <stop offset=".55" stopColor="#ffffff" />
            <stop offset="1" stopColor="#d2d5da" />
          </linearGradient>
        </defs>
        <path d="M-80 960C250 910 330 1040 640 990" fill="none" stroke="url(#neu-silber)" strokeWidth="44" />
      </svg>

      <svg className="neu-schleife" viewBox="1160 0 380 290" preserveAspectRatio="xMaxYMin meet">
        <defs>
          <linearGradient id="neu-falte" x1="0" y1="0" x2=".5" y2="1">
            <stop stopColor="#ffbd91" />
            <stop offset=".36" stopColor="#ff754c" />
            <stop offset=".7" stopColor="#f04a28" />
            <stop offset="1" stopColor="#c9361a" />
          </linearGradient>
        </defs>
        <path
          d="M1220 -60C1300 130 1460 120 1600 230"
          fill="none"
          stroke="#000"
          strokeWidth="96"
          opacity=".08"
          transform="translate(0 10)"
        />
        <path d="M1220 -60C1300 130 1460 120 1600 230" fill="none" stroke="url(#neu-falte)" strokeWidth="96" />
      </svg>
    </div>
  );
}

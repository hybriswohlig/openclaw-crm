"use client";
/**
 * Lagekarte: Ladeskelett mit Brett-Silhouette (Umriss Baden-Württemberg,
 * vereinfacht aus public/geo/bw-land.geojson). Klein und ohne Karten-Code,
 * damit /home es zeigen kann, während der Kartenteil noch nachlädt.
 */
import { useTheme } from "next-themes";
import "./lagekarte.css";

/** Umriss BW, Douglas-Peucker-vereinfacht, viewBox 0 0 200 230. */
const BW_UMRISS =
  "M141 225L144 222L150 223L157 215L165 218L168 215L171 215L173 218L176 215L176 207L172 204L177 201L173 197L175 189L173 186L175 185L177 180L177 172L172 160L172 154L166 144L170 139L170 136L174 135L179 136L183 133L185 130L189 129L187 122L189 120L185 115L186 111L190 112L191 116L194 115L195 111L198 115L200 113L200 110L196 106L195 104L198 100L196 97L198 96L198 92L196 91L198 89L197 86L191 80L191 78L185 76L184 71L181 71L185 67L184 65L181 65L177 60L175 54L178 53L177 48L174 46L175 42L178 40L176 36L174 35L175 34L174 30L175 29L173 28L173 25L170 27L171 28L168 31L163 31L161 21L158 25L155 24L159 18L156 13L156 9L153 7L150 11L147 7L144 11L142 9L144 0L135 3L134 0L130 2L129 0L121 3L124 9L126 8L126 7L128 8L128 15L121 14L118 16L119 18L117 21L107 22L107 24L105 23L109 28L107 29L107 27L105 27L101 30L99 29L96 33L97 34L91 40L87 40L87 38L89 37L89 33L90 31L92 33L93 29L89 30L88 28L87 28L81 26L79 17L73 19L75 25L73 28L70 28L64 21L61 21L61 24L64 32L63 35L67 36L64 41L67 42L63 48L66 51L59 57L60 58L58 64L57 70L52 82L46 85L39 101L35 103L34 105L31 105L31 108L22 117L19 123L20 130L18 132L15 143L16 148L12 152L10 160L5 170L4 179L7 186L3 195L1 204L2 211L0 213L5 224L7 226L9 224L10 224L12 226L9 229L11 230L19 228L21 225L26 225L27 229L39 228L47 221L48 223L50 222L53 223L55 226L62 227L64 226L64 224L68 220L71 222L71 223L72 224L74 222L74 216L65 219L60 216L63 209L66 206L70 205L71 202L74 203L75 207L77 204L79 207L83 208L81 209L82 211L82 214L86 216L87 213L85 211L87 210L90 212L92 218L96 217L100 214L100 212L96 211L98 209L107 213L109 217L114 217L112 210L105 205L103 201L115 209L117 212L121 216L133 218L136 224Z";

/** Nur die Silhouette mit Text, ohne eigene Wurzel (für Überlagerungen im Container). */
export function BrettSilhouette({ text = "Lage wird geladen …" }: { text?: string }) {
  return (
    <div className="flex flex-col items-center gap-4" role="status" aria-live="polite">
      <svg viewBox="-8 -8 216 252" className="lk-skelett h-[min(42vh,320px)] w-auto" aria-hidden="true">
        <path d={BW_UMRISS} transform="translate(0 7)" fill="var(--lk-panel-rand)" />
        <path d={BW_UMRISS} fill="var(--lk-panel)" stroke="var(--lk-text-schwach)" strokeOpacity="0.45" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
      <p className="k-mono text-[12px] uppercase tracking-[0.12em]" style={{ color: "var(--lk-text-leise)" }}>
        {text}
      </p>
    </div>
  );
}

/** Vollflächiges Ladebild mit eigener .lagekarte-Wurzel (Tokens hell/dunkel). */
export default function Ladebild() {
  const { resolvedTheme } = useTheme();
  return (
    <div
      className={`lagekarte ${resolvedTheme === "dark" ? "lagekarte--dunkel" : ""} relative flex h-full w-full items-center justify-center overflow-hidden`}
    >
      <BrettSilhouette />
    </div>
  );
}

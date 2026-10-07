"use client";
/**
 * Kleine SVG-Form je Kartenstatus (gleiche Formen wie die Karten-Icons),
 * für Leiste, Legende und Panel. Farbe nie allein: immer Form plus Farbe.
 */
import type { KartenStatus } from "@/lib/lagekarte/typen";
import { STATUS_STIL, WARTET_FARBE, type Thema } from "@/lib/lagekarte/farben";

export function StatusForm({
  status,
  thema,
  groesse = 14,
  wartet = false,
  className,
}: {
  status: KartenStatus;
  thema: Thema;
  groesse?: number;
  wartet?: boolean;
  className?: string;
}) {
  const stil = STATUS_STIL[status];
  const farbe = stil.farbe[thema];
  const halo = thema === "hell" ? "#ffffff" : "#0b1018";
  const s = groesse;
  const c = s / 2;
  const r = s * 0.34;
  let form: React.ReactNode;
  switch (stil.form) {
    case "kreis":
      form = <circle cx={c} cy={c} r={r} fill={farbe} stroke={halo} strokeWidth={s * 0.1} />;
      break;
    case "ring":
      form = <circle cx={c} cy={c} r={r * 0.92} fill={halo} stroke={farbe} strokeWidth={s * 0.16} />;
      break;
    case "raute":
      form = (
        <polygon
          points={`${c},${c - r * 1.15} ${c + r * 1.15},${c} ${c},${c + r * 1.15} ${c - r * 1.15},${c}`}
          fill={farbe}
          stroke={halo}
          strokeWidth={s * 0.08}
        />
      );
      break;
    case "sechseck": {
      const pts = Array.from({ length: 6 }, (_, i) => {
        const w = (Math.PI / 3) * i + Math.PI / 6;
        return `${c + r * 1.18 * Math.cos(w)},${c + r * 1.18 * Math.sin(w)}`;
      }).join(" ");
      form = <polygon points={pts} fill={farbe} stroke={halo} strokeWidth={s * 0.08} />;
      break;
    }
    case "punkt":
      form = <circle cx={c} cy={c} r={r * 0.62} fill={farbe} opacity={0.75} />;
      break;
    case "kreuz":
      form = (
        <g stroke={farbe} strokeWidth={s * 0.13} strokeLinecap="round">
          <line x1={c - r * 0.75} y1={c - r * 0.75} x2={c + r * 0.75} y2={c + r * 0.75} />
          <line x1={c + r * 0.75} y1={c - r * 0.75} x2={c - r * 0.75} y2={c + r * 0.75} />
        </g>
      );
      break;
    case "quadrat":
      form = <rect x={c - r * 0.85} y={c - r * 0.85} width={r * 1.7} height={r * 1.7} rx={s * 0.08} fill={farbe} stroke={halo} strokeWidth={s * 0.08} />;
      break;
  }
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} aria-hidden="true" className={className} style={{ flex: "none" }}>
      {wartet && <circle cx={c} cy={c} r={c - s * 0.05} fill="none" stroke={WARTET_FARBE[thema]} strokeWidth={s * 0.1} />}
      {form}
    </svg>
  );
}

import type { FirmaKurz } from "@/lib/bewertungen-kunden";
import { firmaKurz } from "./kunden-logik";

/** Ein Chip je Firma (Kottke blau, Ceylan violett), damit beide Firmen sichtbar getrennt sind. */
export function FirmenChips({ firmen }: { firmen: FirmaKurz[] }) {
  if (firmen.length === 0) return null;
  return (
    <span className="kd-chips">
      {firmen.map((f) => (
        <span key={f.id} className="kd-chip" data-marke={f.marke ?? undefined} title={f.name}>
          {firmaKurz(f.name)}
        </span>
      ))}
    </span>
  );
}

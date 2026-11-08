import Link from "next/link";
import { LEGENDE } from "./plan-logik";

/**
 * Legende unter dem Raster (Entscheidung 15): Farbe und Bedeutung, mit
 * `kapazitaet` (Plan 12a) der Chip „N frei“ und der Schalter „Kapazität
 * anzeigen“. `abo`: rechts „Kalender-Abo“, sichtbar nur, wenn die Leiste dafür
 * zu schmal ist (neu-plan.css).
 */
export function Legende({
  abo,
  kapazitaet,
}: {
  abo: boolean;
  kapazitaet?: { an: boolean; onUmschalten: (an: boolean) => void } | null;
}) {
  return (
    <ul className="plan-legende" aria-label="Legende">
      {LEGENDE.map((l) => (
        <li key={l.ton}>
          <i data-ton={l.ton} aria-hidden="true" />
          {l.text}
        </li>
      ))}
      {kapazitaet?.an ? (
        <li>
          <span className="plan-kap-chip plan-kap-legende" data-ton="gruen">
            <i aria-hidden="true" />3 frei
          </span>
          Personen ohne festen Umzug und ohne Abwesenheit
        </li>
      ) : null}
      {kapazitaet ? (
        <li>
          <label className="plan-kap-schalter">
            <input type="checkbox" checked={kapazitaet.an} onChange={(e) => kapazitaet.onUmschalten(e.target.checked)} />
            Kapazität anzeigen
          </label>
        </li>
      ) : null}
      {abo ? (
        <li className="plan-legende-abo">
          <Link href="/contract-calendar" className="plan-abo">
            Kalender-Abo
          </Link>
        </li>
      ) : null}
    </ul>
  );
}

import Link from "next/link";
import { LEGENDE } from "./plan-logik";

/**
 * Legende unter dem Raster (Entscheidung 15): Farbe und Bedeutung, keine
 * Transporter, keine Kapazität. `abo`: rechts „Kalender-Abo“, sichtbar nur,
 * wenn die Leiste dafür zu schmal ist (neu-plan.css).
 */
export function Legende({ abo }: { abo: boolean }) {
  return (
    <ul className="plan-legende" aria-label="Legende">
      {LEGENDE.map((l) => (
        <li key={l.ton}>
          <i data-ton={l.ton} aria-hidden="true" />
          {l.text}
        </li>
      ))}
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

import { LEGENDE } from "./plan-logik";

/** Legende unter dem Raster (Entscheidung 15): Farbe und Bedeutung, keine Transporter, keine Kapazität. */
export function Legende() {
  return (
    <ul className="plan-legende" aria-label="Legende">
      {LEGENDE.map((l) => (
        <li key={l.ton}>
          <i data-ton={l.ton} aria-hidden="true" />
          {l.text}
        </li>
      ))}
    </ul>
  );
}

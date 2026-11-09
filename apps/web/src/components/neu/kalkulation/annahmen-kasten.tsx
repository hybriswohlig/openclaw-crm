"use client";

import "@/styles/neu-kalk-p15.css";

import type { AnnahmenKasten as Kasten } from "@/lib/kalkulation-p15";

/** Ereignis, mit dem der Kasten die Inventarliste der Grundlage öffnet. */
export const INVENTAR_OEFFNEN_EVENT = "kalk-inventar-oeffnen";

/** Springt zur Grundlage-Zeile `ziel` und hebt sie kurz hervor; „positionen“ öffnet die Inventarliste. */
export function zuGrundlage(ziel: string) {
  if (typeof document === "undefined") return;
  if (ziel === "positionen") {
    window.dispatchEvent(new CustomEvent(INVENTAR_OEFFNEN_EVENT));
    return;
  }
  const el = document.querySelector<HTMLElement>(`.kalk-zeile[data-key="${CSS.escape(ziel)}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.removeAttribute("data-sprung");
  void el.offsetWidth;
  el.setAttribute("data-sprung", "");
  window.setTimeout(() => el.removeAttribute("data-sprung"), 1700);
  el.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
}

/**
 * Kasten „Damit hat der Rechner gerechnet“ (Plan 15, Bauteil 1): gold, nur mit
 * Annahmen. Gruppen Adressen und Strecke, Fahrzeit, Etagen, Volumen, Team; jede
 * Zeile springt zur passenden Grundlage-Zeile. Intern, kein Kundentext.
 */
export function AnnahmenKasten({ kasten }: { kasten: Kasten | null }) {
  if (!kasten || kasten.gruppen.length === 0) return null;
  return (
    <section className="kalk-annahmen" aria-label="Damit hat der Rechner gerechnet">
      <div className="kalk-annahmen-kopf">
        <h2>Damit hat der Rechner gerechnet</h2>
        <p>Annahmen, die im Preis stecken. Klick führt zur Zeile, wo sie sich ändern lassen.</p>
      </div>
      <div className="kalk-annahmen-gruppen">
        {kasten.gruppen.map((g) => (
          <div key={g.key} className="kalk-annahmen-gruppe">
            <h3>{g.titel}</h3>
            <ul>
              {g.zeilen.map((z, i) => (
                <li key={`${g.key}-${i}`}>
                  <button type="button" className="kalk-annahme" onClick={() => zuGrundlage(z.ziel)}>
                    {z.text}
                  </button>
                  {z.details && z.details.length > 0 ? (
                    <details className="kalk-annahme-details">
                      <summary>{z.details.length === 1 ? "1 Position zeigen" : `${z.details.length} Positionen zeigen`}</summary>
                      <ul>
                        {z.details.map((d, j) => (
                          <li key={j}>{d}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

"use client";

import "@/styles/neu-einsatz.css";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { tagKurz } from "@/lib/anzeige";
import { ABWESENHEIT_TEXT, type KapazitaetTag } from "@/lib/einsatz";

/** Gemerkt je Browser (Plan 12a, Task U). */
export const KAPAZITAET_SCHLUESSEL = "neu.plan.kapazitaet";

export function kapazitaetGemerkt(): boolean {
  try {
    return window.localStorage.getItem(KAPAZITAET_SCHLUESSEL) !== "aus";
  } catch {
    return true;
  }
}

export function kapazitaetMerken(an: boolean): void {
  try {
    window.localStorage.setItem(KAPAZITAET_SCHLUESSEL, an ? "an" : "aus");
  } catch {
    // Ohne Speicher gilt die Wahl nur bis zum Neuladen.
  }
}

/** Gibt es überhaupt aktive Mitarbeiter? Sonst blendet der Plan den Chip aus. */
export function hatKapazitaet(liste: readonly KapazitaetTag[] | undefined): boolean {
  return (liste ?? []).some((k) => k.frei.length + k.belegt.length + k.abwesend.length > 0);
}

/**
 * Chip „N frei“ je Tag (Ton nach `kapazitaetTon`); Klick zeigt frei, belegt
 * mit Deal und abwesend mit Art. Nur Namen, keine Zahlen zu Geld.
 */
export function KapazitaetChip({ k }: { k: KapazitaetTag }) {
  const [offen, setOffen] = useState(false);
  const id = useId();
  const rahmen = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!offen) return;
    const weg = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape") setOffen(false);
        return;
      }
      if (rahmen.current && !rahmen.current.contains(e.target as Node)) setOffen(false);
    };
    document.addEventListener("mousedown", weg);
    document.addEventListener("keydown", weg);
    return () => {
      document.removeEventListener("mousedown", weg);
      document.removeEventListener("keydown", weg);
    };
  }, [offen]);

  return (
    <span className="plan-kap" ref={rahmen}>
      <button
        type="button"
        className="plan-kap-chip"
        data-ton={k.ton}
        aria-expanded={offen}
        aria-controls={id}
        aria-label={`${tagKurz(k.tag)}: ${k.text}, Namen zeigen`}
        onClick={(e) => {
          e.stopPropagation();
          setOffen((o) => !o);
        }}
      >
        <i aria-hidden="true" />
        {k.text}
      </button>
      {offen ? (
        <span id={id} className="plan-kap-pop" role="dialog" aria-label={`Kapazität am ${tagKurz(k.tag)}`}>
          <b>{tagKurz(k.tag)}</b>
          <span className="plan-kap-gruppe">
            <span className="plan-kap-titel">frei</span>
            {k.frei.length > 0 ? k.frei.map((p) => p.name).join(", ") : "niemand"}
          </span>
          {k.belegt.length > 0 ? (
            <span className="plan-kap-gruppe">
              <span className="plan-kap-titel">belegt</span>
              {k.belegt.map((b) => (
                <span key={b.person.id} className="plan-kap-zeile">
                  {b.person.name}:{" "}
                  {b.deals.map((d, i) => (
                    <span key={d.dealId}>
                      {i > 0 ? ", " : null}
                      <Link href={`/app/leads/${d.dealId}`}>{d.titel}</Link>
                    </span>
                  ))}
                </span>
              ))}
            </span>
          ) : null}
          {k.abwesend.length > 0 ? (
            <span className="plan-kap-gruppe">
              <span className="plan-kap-titel">abwesend</span>
              {k.abwesend.map((a) => `${a.person.name} (${ABWESENHEIT_TEXT[a.art]})`).join(", ")}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

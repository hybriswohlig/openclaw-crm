"use client";

import Link from "next/link";
import type { BewertungZeile } from "@/lib/bewertungen-kunden";
import { AKTION_TEXT, zeileAktionen, zeileText, type ZeilenAktion } from "./bewertungen-logik";

/** Eine Zeile der Arbeitsliste: Kunde, Deal, Firma, Zeit oder Grund, Aktionen. */
export function BewertungZeileAnsicht({
  zeile: z,
  laeuft,
  onAktion,
}: {
  zeile: BewertungZeile;
  laeuft: boolean;
  onAktion: (a: ZeilenAktion) => void;
}) {
  const aktionen = zeileAktionen(z);
  return (
    <li className="bew-zeile" data-liste={z.liste} data-grund={z.grund ?? undefined}>
      <div className="bew-zeile-haupt">
        {z.kunde ? (
          <Link href={`/app/kunden/${z.kunde.personId}`} className="bew-zeile-name">
            {z.kunde.name}
          </Link>
        ) : (
          <span className="bew-zeile-name" data-leer>
            Ohne Kunde
          </span>
        )}
        <Link href={`/app/leads/${z.dealId}`} className="bew-zeile-deal">
          {[z.dealNummer, z.titel].filter(Boolean).join(" · ")}
        </Link>
      </div>
      {z.firma ? (
        <span className="bew-chip" data-marke={z.firma.marke ?? undefined}>
          {z.firma.name.trim().split(/\s+/)[0]}
        </span>
      ) : (
        <span />
      )}
      <span className="bew-zeile-text">{zeileText(z)}</span>
      <span className="bew-zeile-knoepfe">
        {aktionen.map((a) => (
          <button
            key={a}
            type="button"
            className="akte-ablauf-knopf bew-knopf"
            data-ton={a === "verwerfen" ? "grau" : undefined}
            disabled={laeuft}
            aria-busy={laeuft || undefined}
            onClick={() => onAktion(a)}
          >
            {AKTION_TEXT[a]}
          </button>
        ))}
      </span>
    </li>
  );
}

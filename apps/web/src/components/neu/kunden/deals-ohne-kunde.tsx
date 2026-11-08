"use client";

import Link from "next/link";
import type { DealOhneKunde } from "@/lib/bewertungen-kunden";
import { FirmenChips } from "./firmen-chips";
import { datum } from "./kunden-logik";

/** Deals ohne verknüpfte Person (letzte 12 Monate, nicht verloren): Link in die Akte. */
export function DealsOhneKunde({ zeilen }: { zeilen: DealOhneKunde[] }) {
  return (
    <ul className="kd-zeilen">
      {zeilen.map((d) => (
        <li key={d.dealId} className="kd-zeile">
          <div className="kd-zeile-haupt">
            <Link href={`/app/leads/${d.dealId}`} className="kd-zeile-name">
              {d.titel || "Ohne Namen"}
            </Link>
            <span className="kd-zeile-meta">{[d.dealNummer, d.stufe.label].filter(Boolean).join(" · ")}</span>
          </div>
          <FirmenChips firmen={d.firma ? [d.firma] : []} />
          <span className="kd-zeile-text">angelegt {datum(d.angelegtAm)}</span>
          <span className="kd-zeile-betrag" />
        </li>
      ))}
    </ul>
  );
}

"use client";

import Link from "next/link";
import type { KundenZeile } from "@/lib/bewertungen-kunden";
import { FirmenChips } from "./firmen-chips";
import { datum, euro } from "./kunden-logik";

/** Kunden oder Anfragen als Zeilen: Name (zur Kundenakte), Telefon, Firmen, Aufträge, letzter Umzug, offen. */
export function KundenListe({ zeilen }: { zeilen: KundenZeile[] }) {
  return (
    <ul className="kd-zeilen">
      {zeilen.map((z) => (
        <li key={z.personId} className="kd-zeile">
          <div className="kd-zeile-haupt">
            <Link href={`/app/kunden/${z.personId}`} className="kd-zeile-name">
              {z.name}
            </Link>
            <span className="kd-zeile-meta">
              {[z.telefon, z.wiederkehrer ? "Wiederkehrer" : null, z.dublette ? "mögliche Dublette" : null]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
          <FirmenChips firmen={z.firmen} />
          <span className="kd-zeile-text">
            {z.auftraege === 1 ? "1 Auftrag" : `${z.auftraege} Aufträge`}
            {z.letzterUmzug ? ` · zuletzt ${datum(z.letzterUmzug)}` : ""}
          </span>
          <span className="kd-zeile-betrag" data-offen={z.offenCent != null && z.offenCent > 0 ? true : undefined}>
            {z.offenCent == null ? "" : z.offenCent > 0 ? `${euro(z.offenCent)} offen` : "nichts offen"}
          </span>
        </li>
      ))}
    </ul>
  );
}

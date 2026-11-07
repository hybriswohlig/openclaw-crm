"use client";

import {
  stundenAnzeige,
  stundenZahl,
  tagKurz,
  type KvaSnapshot,
  type PortalPreis,
  type StundenAnzeige,
} from "@openclaw-crm/customer-portal-core";
import { formatPortalMoney } from "./portal-presentation";

/**
 * Plan 5b: Preisangaben, die Preiskarte, Mobil-Leiste, Brief, Annahmedialog
 * und Vorschau gleich nennen. Ohne Tagespreise und ohne Stunden-KV aus der
 * Version liefern alle Hilfen genau die Texte von vor 5b (oder nichts).
 */

/** Art des Preises über dem Betrag: „Festpreis“, „Voraussichtlich“, beim alten Stunden-KV „Stundensatz“ (F11). */
export function preisArt(kva: Pick<KvaSnapshot, "isVariable">, stunden: StundenAnzeige): string {
  if (stunden?.modell === "alt") return "Stundensatz";
  return kva.isVariable ? "Voraussichtlich" : "Festpreis";
}

/** Betrag unter der Preisart: beim alten Stunden-KV der Stundensatz, sonst der angezeigte Preis. */
export function preisBetragCents(displayTotalCents: number, stunden: StundenAnzeige): number {
  return stunden?.modell === "alt" ? stunden.satzCents : displayTotalCents;
}

export function stundenVon(kva: KvaSnapshot | null | undefined): StundenAnzeige {
  return stundenAnzeige(kva);
}

/** „je Stunde“ hinter dem Betrag beim alten Stunden-KV. */
export function JeStunde({ stunden }: { stunden: StundenAnzeige }) {
  if (stunden?.modell !== "alt") return null;
  return <span className="ml-1 text-[0.45em] font-medium tracking-normal text-muted-foreground">je Stunde</span>;
}

/**
 * Zeilen unter dem Betrag: der Tag, an dem der Preis gilt, und beim
 * Stunden-KV aus der Version die Mindeststunden. Ohne beides nichts.
 */
export function PreisZusatz({
  preis,
  stunden,
  className = "mt-2 text-[11px] leading-relaxed text-muted-foreground",
}: {
  preis: PortalPreis;
  stunden: StundenAnzeige;
  className?: string;
}) {
  const tagZeile = preis.tag
    ? preis.tagGewaehlt
      ? `Preis an diesem Tag: ${tagKurz(preis.tag.date)}`
      : `Preis am empfohlenen Termin ${tagKurz(preis.tag.date)}`
    : null;
  const stundenZeile =
    stunden?.modell === "version"
      ? `Abgerechnet nach Aufwand, mindestens ${stundenZahl(stunden.stunden.mindestStunden)} (${formatPortalMoney(stunden.stunden.mindestbetragCent)})`
      : null;
  if (!tagZeile && !stundenZeile) return null;
  return (
    <div className={className} data-portal-preis-zusatz="">
      {tagZeile && <p>{tagZeile}</p>}
      {stundenZeile && <p>{stundenZeile}</p>}
    </div>
  );
}

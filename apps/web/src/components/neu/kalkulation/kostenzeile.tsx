"use client";

import type { SelbstkostenGruppe, SelbstkostenUnterzeile } from "@/lib/kalkulations-ansicht";
import { euro } from "@/components/neu/akte/format";

/**
 * Schlüssel der Kostenzeile des Rechners, die eine Gruppe übersteuert
 * (`art: "zeile"`). Die Gruppen der Ansicht heißen kurz („arbeit“), die
 * Zeilen des Rechners tragen Präfixe („personal.arbeit“); der Rest ist gleich.
 */
export function postenKeyFuer(gruppe: Pick<SelbstkostenGruppe, "key">): string {
  switch (gruppe.key) {
    case "arbeit":
      return "personal.arbeit";
    case "fahrt":
      return "personal.fahrt";
    case "anfahrt":
      return "anfahrtsgeld";
    default:
      return gruppe.key;
  }
}

/** Unterzeilen aus Personenstunden und Zeitposten sind abgeleitet; nur echte Kostenzeilen lassen sich als Zeile übersteuern. */
export function unterzeileUebersteuerbar(z: Pick<SelbstkostenUnterzeile, "key">): boolean {
  return !z.key.startsWith("arbeit.") && !z.key.startsWith("zeitposten.") && !z.key.startsWith("material_frei.");
}

/** Hauptzeile einer Gruppe: Titel, Betrag mit Formel darunter; Klick öffnet den Anpassungs-Dialog. */
export function KostenGruppeZeile({
  gruppe,
  beschaeftigt,
  onKlick,
}: {
  gruppe: SelbstkostenGruppe;
  beschaeftigt: boolean;
  onKlick?: (gruppe: SelbstkostenGruppe) => void;
}) {
  const inhalt = (
    <>
      <span className="kalk-kz-t">{gruppe.label}</span>
      <span className="kalk-kz-a">
        {euro(gruppe.betragCent)}
        {gruppe.formel ? <small>{gruppe.formel}</small> : null}
      </span>
    </>
  );
  if (!onKlick) {
    return (
      <div className="kalk-kz" data-uebersteuert={gruppe.uebersteuert ? "" : undefined}>
        {inhalt}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="kalk-kz"
      data-uebersteuert={gruppe.uebersteuert ? "" : undefined}
      disabled={beschaeftigt}
      onClick={() => onKlick(gruppe)}
      aria-label={`${gruppe.label} ${euro(gruppe.betragCent)}${gruppe.uebersteuert ? ", überschrieben" : ""}, anpassen`}
    >
      {inhalt}
    </button>
  );
}

/** Unterzeile, 28 px eingerückt: Text (mit Formel) und Wert; übersteuert in Gold. */
export function KostenUnterzeile({
  zeile,
  beschaeftigt,
  onKlick,
}: {
  zeile: SelbstkostenUnterzeile;
  beschaeftigt: boolean;
  onKlick?: (zeile: SelbstkostenUnterzeile) => void;
}) {
  const inhalt = (
    <>
      <span>
        {zeile.label}
        {zeile.formel ? <span className="kalk-ku-f"> · {zeile.formel}</span> : null}
      </span>
      <span className="kalk-ku-a">{zeile.wert}</span>
    </>
  );
  if (!onKlick) {
    return (
      <div className="kalk-ku" data-uebersteuert={zeile.uebersteuert ? "" : undefined}>
        {inhalt}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="kalk-ku"
      data-uebersteuert={zeile.uebersteuert ? "" : undefined}
      disabled={beschaeftigt}
      onClick={() => onKlick(zeile)}
      aria-label={`${zeile.label} ${zeile.wert}${zeile.uebersteuert ? ", überschrieben" : ""}, anpassen`}
    >
      {inhalt}
    </button>
  );
}

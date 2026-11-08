"use client";

import Link from "next/link";
import type { KasseSchlange, KasseZeile } from "@/lib/geld";
import { betragText, KASSE_AKTION } from "./kasse-logik";

/**
 * Eine Zeile der Kasse: Name (zur Akte), Nummer, Firma, Betrag, Text
 * (fällig, überfällig, Termin, Erinnerung) und die Aktion der Schlange.
 * Gold, wenn sie auf euch wartet.
 */
export function KasseZeileAnsicht({
  zeile: z,
  schlange,
  laeuft,
  onAktion,
  onVerwerfen,
}: {
  zeile: KasseZeile;
  schlange: KasseSchlange;
  laeuft: boolean;
  onAktion: () => void;
  /** Nur bei Meldungen: „Verwerfen“. */
  onVerwerfen?: () => void;
}) {
  return (
    <li className="kasse-zeile" data-gold={z.gold || undefined}>
      <div className="kasse-zeile-haupt">
        <Link href={z.href} className="kasse-zeile-name">
          {z.name}
        </Link>
        <span className="kasse-zeile-meta">{[z.nummer, z.firmaName].filter(Boolean).join(" · ")}</span>
      </div>
      <span className="kasse-zeile-text">{z.text}</span>
      <span className="kasse-zeile-betrag" data-unbekannt={z.betragCent == null || undefined}>
        {betragText(z.betragCent)}
      </span>
      <span className="kasse-zeile-knoepfe">
        <button type="button" className="akte-ablauf-knopf geld-knopf-klein" disabled={laeuft} aria-busy={laeuft || undefined} onClick={onAktion}>
          {laeuft ? "Läuft …" : KASSE_AKTION[schlange]}
        </button>
        {onVerwerfen ? (
          <button type="button" className="akte-ablauf-knopf geld-knopf-klein" data-ton="grau" disabled={laeuft} onClick={onVerwerfen}>
            Verwerfen
          </button>
        ) : null}
      </span>
    </li>
  );
}

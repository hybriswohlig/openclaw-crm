/**
 * Stunden-Anteil am Preis-Hash (Plan 5b, Review M4).
 *
 * `preisHash` (Vertrag in `lib/angebot-wahl.ts`, unverändert) deckt im
 * Stundenmodus nur die Schätzung ab. Sätze, Helfer, Transporter, Stunden,
 * Mindeststunden, Mindestbetrag und Zusatzposten sind aber ebenfalls
 * Kundenpreise: Ändert der Rechner einen davon zwischen Anzeige und Sperren,
 * muss das Sperren mit PREIS_GEAENDERT antworten, auch wenn die Schätzung gleich
 * bleibt (z. B. 4 Helfer × 30 € statt 3 × 40 €).
 *
 * Der Anteil hängt mit `#` an den Vertrags-Hash an. Ohne Stunden (Festpreis,
 * Pakete, Tage) bleibt der Hash Zeichen für Zeichen wie vorher. Seite
 * (`lib/kalkulations-ansicht.ts`) und Sperren (`plan5Preise` in
 * `services/kalkulation-versionen.ts`) müssen ihn beide anhängen, sonst passt
 * der Hash der Seite nie.
 */
import type { RechnerStunden } from "@/lib/angebot-wahl";

const cent = (eur: number) => Math.round(eur * 100);

/** Lesbarer, deterministischer Schlüssel über alle Kundenangaben eines Stunden-KV. */
export function stundenHashTeil(s: RechnerStunden): string {
  const zusatz = s.zusatzposten.map((z) => `${z.bezeichnung.trim()}=${cent(z.betrag)}`).join(",");
  return [
    `helfer=${s.helfer}`,
    `transporter=${s.transporter}`,
    `satzHelfer=${cent(s.satzHelferEur)}`,
    `satzTransporter=${cent(s.satzTransporterEur)}`,
    `stunden=${s.stundenGeschaetzt}`,
    `mindestStunden=${s.mindestStunden}`,
    `mindestbetrag=${cent(s.mindestbetragEur)}`,
    `zusatz=${zusatz}`,
  ].join(";");
}

/** Vertrags-Hash plus Stunden-Anteil; ohne Stunden genau der Vertrags-Hash. */
export function preisHashMitStunden(vertragsHash: string, stunden: RechnerStunden | null | undefined): string {
  return stunden ? `${vertragsHash}#stunden:${stundenHashTeil(stunden)}` : vertragsHash;
}

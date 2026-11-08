/**
 * Reine Zeilen der Arbeitsliste /app/bewertungen (Plan 11, Task B).
 * `bewertungLage` entscheidet die Liste; hier kommen nur Anzeige-Felder dazu.
 * Altsperren (Grund ALTSPERRE) fallen aus den Zeilen: sie zählen nur als Zahl.
 */
import {
  ANKER_VERZUG_MS,
  bewertungLage,
  tokenFreigebbar,
  tokenLage,
  type BewertungListe,
  type BewertungListenRoh,
  type BewertungZeile,
  type FirmaKurz,
} from "@/lib/bewertungen-kunden";

export type BewertungZeileRoh = BewertungListenRoh & {
  titel: string;
  dealNummer: string | null;
  kunde: { personId: string; name: string } | null;
  firma: FirmaKurz | null;
  angefragtAm: Date | null;
  vormerkungId: string | null;
  /** Anker (vollständig bezahlt). Bei Liste „fällig“ wird daraus die Berechtigung. */
  anker?: Date | null;
};

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

export function bewertungZeilen(roh: BewertungZeileRoh[], jetzt: Date): BewertungZeile[] {
  const aus: BewertungZeile[] = [];
  for (const r of roh) {
    const lage = bewertungLage(r, jetzt);
    if (lage.grund === "ALTSPERRE") continue;
    const lageToken = r.token ? tokenLage(r.token, jetzt) : null;
    const freigebbar = !!(r.token && lageToken && tokenFreigebbar(lageToken) && !r.token.clickedAt);
    const faelligAb =
      lage.liste === "faellig" && r.anker
        ? new Date(r.anker.getTime() + ANKER_VERZUG_MS).toISOString()
        : iso(lage.faelligAb);
    aus.push({
      dealId: r.dealId,
      dealNummer: r.dealNummer,
      titel: r.titel,
      kunde: r.kunde,
      firma: r.firma,
      liste: lage.liste,
      grund: lage.grund,
      faelligAb,
      angefragtAm: iso(r.angefragtAm),
      geklicktAm: iso(r.token?.clickedAt),
      quelle: r.token?.quelle ?? r.vormerkung?.art ?? null,
      vormerkungId: r.vormerkungId,
      tokenFreigebbar: freigebbar,
    });
  }
  return aus;
}

const LISTEN: readonly BewertungListe[] = ["freigabe", "vorgemerkt", "faellig", "angefragt", "geklickt", "gesperrt"];

/** Alle sechs Listen, auch wenn eine Liste keine Zeile hat. */
export function zaehlerAus(zeilen: BewertungZeile[]): Record<BewertungListe, number> {
  const z = Object.fromEntries(LISTEN.map((l) => [l, 0])) as Record<BewertungListe, number>;
  for (const zeile of zeilen) z[zeile.liste] += 1;
  return z;
}

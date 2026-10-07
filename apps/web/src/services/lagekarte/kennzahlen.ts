/**
 * Lagekarte: Kennzahlen (HUD) aus den bereits berechneten Lead-Punkten.
 * Reine Funktion, keine DB. Datums- und Monatsgrenzen in Europe/Berlin.
 */
import { berlinDateString } from "@/lib/berlin-date";
import type { Kennzahlen, LeadPunkt } from "@/lib/lagekarte/typen";

/** YYYY-MM-DD plus n Kalendertage, rein kalendarisch (UTC-Rechnung, keine Sommerzeit-Effekte). */
function plusTage(datum: string, tage: number): string {
  const [j, m, t] = datum.split("-").map(Number);
  return new Date(Date.UTC(j, m - 1, t + tage)).toISOString().slice(0, 10);
}

export function berechneKennzahlen(leads: LeadPunkt[], jetzt: Date): Kennzahlen {
  const heute = berlinDateString(jetzt);
  const monat = heute.slice(0, 7);
  const fensterEnde = plusTage(heute, 6);

  const wartende = leads.filter((l) => l.wartet !== null);
  const aeltesteSeit = wartende.reduce<string | null>((aelteste, l) => {
    const seit = l.wartet!.seit;
    return aelteste === null || new Date(seit).getTime() < new Date(aelteste).getTime() ? seit : aelteste;
  }, null);

  const angebote = leads.filter((l) => l.status === "angebot");
  const aktive = leads.filter((l) => l.status !== "verloren");

  const angenommen = leads.filter(
    (l) => l.kv.angenommenAm !== null && berlinDateString(new Date(l.kv.angenommenAm)).slice(0, 7) === monat,
  );

  return {
    wartet: {
      gesamt: wartende.length,
      antwort: wartende.filter((l) => l.wartet!.art === "antwort").length,
      neuPruefen: wartende.filter((l) => l.wartet!.art === "neu_pruefen").length,
      aeltesteSeit,
    },
    emailUngelesen: { leads: aktive.filter((l) => l.emailUngelesen > 0).length },
    angeboteOffen: {
      anzahl: angebote.length,
      ungesehen: angebote.filter((l) => l.kv.linkAktiv && l.kv.linkAngesehenAnzahl === 0).length,
    },
    angenommenMonat: {
      anzahl: angenommen.length,
      cent: angenommen.reduce((summe, l) => summe + (l.wert?.art === "bestaetigt" ? l.wert.cent : 0), 0),
      monat,
    },
    umzuegeNaechste7Tage: leads.filter(
      (l) =>
        (l.status === "auftrag" || l.status === "erledigt") &&
        l.umzugAm !== null &&
        l.umzugAm >= heute &&
        l.umzugAm <= fensterEnde,
    ).length,
    verortet: { mitOrt: aktive.filter((l) => l.ort !== null).length, gesamt: aktive.length },
  };
}

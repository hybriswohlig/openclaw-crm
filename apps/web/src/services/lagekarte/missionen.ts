/**
 * Lagekarte: Missionen (nächste beste Aktion) nur aus belastbaren Signalen.
 * Reine Funktion, keine DB. Verlorene Leads erzeugen nie Missionen.
 */
import { berlinDateString } from "@/lib/berlin-date";
import { euroAusCent } from "@/lib/lagekarte/farben";
import { plausiblerCent, type LeadPunkt, type Mission } from "@/lib/lagekarte/typen";

const TAG_MS = 24 * 60 * 60 * 1000;
const MAX_MISSIONEN = 12;

/** Kalendertage von a nach b (beide YYYY-MM-DD), rein kalendarisch. */
function kalenderTage(von: string, bis: string): number {
  const ms = (d: string) => {
    const [j, m, t] = d.split("-").map(Number);
    return Date.UTC(j, m - 1, t);
  };
  return Math.round((ms(bis) - ms(von)) / TAG_MS);
}

interface Kandidat extends Mission {
  /** Zeitpunkt des Anlasses (ms), kleiner = älter = zuerst. */
  anlass: number;
}

export function erzeugeMissionen(leads: LeadPunkt[], jetzt: Date): Mission[] {
  const heute = berlinDateString(jetzt);
  const alterMs = (iso: string) => jetzt.getTime() - new Date(iso).getTime();
  const alterTage = (iso: string) => Math.floor(alterMs(iso) / TAG_MS);
  const kandidaten: Kandidat[] = [];

  for (const l of leads) {
    if (l.status === "verloren") continue;
    const neu = (art: Mission["art"], titel: string, dringlichkeit: Mission["dringlichkeit"], anlassIso: string) =>
      kandidaten.push({
        id: `${art}:${l.id}`,
        art,
        titel,
        leadId: l.id,
        dringlichkeit,
        anlass: new Date(anlassIso).getTime(),
      });

    if (l.statusHinweis?.startsWith("KV angenommen")) {
      neu("auftrag_stufe", "KV angenommen, Stufe auf „Geplant“ setzen", 1, l.kv.angenommenAm ?? l.angelegtAm);
    }

    if (l.umzugAm && (l.status === "neu" || l.status === "kontakt" || l.status === "angebot")) {
      const n = kalenderTage(heute, l.umzugAm.slice(0, 10));
      if (n >= 0 && n <= 14) {
        const wann = n === 0 ? "heute" : n === 1 ? "morgen" : `in ${n} Tagen`;
        neu("termin_ohne_auftrag", `Umzug ${wann}, noch kein Auftrag`, 1, `${l.umzugAm.slice(0, 10)}T00:00:00Z`);
      }
    }

    if (l.status === "angebot" && l.kv.linkAktiv) {
      if (l.kv.linkAngesehenAnzahl === 0) {
        if (l.kv.linkErstelltAm && alterMs(l.kv.linkErstelltAm) > 3 * TAG_MS) {
          neu("kv_nachfassen", `KV seit ${alterTage(l.kv.linkErstelltAm)} Tagen ungesehen: nachfassen`, 2, l.kv.linkErstelltAm);
        }
      } else if (l.kv.angenommenAm === null && l.kv.linkZuletztAngesehen && alterMs(l.kv.linkZuletztAngesehen) > 5 * TAG_MS) {
        neu("kv_nachfassen", `KV angesehen, seit ${alterTage(l.kv.linkZuletztAngesehen)} Tagen keine Annahme`, 2, l.kv.linkZuletztAngesehen);
      }
    }

    if (l.wert && plausiblerCent(l.wert) === null) {
      neu("wert_pruefen", `Wert prüfen: ${euroAusCent(l.wert.cent)}`, 2, l.kv.angenommenAm ?? l.angelegtAm);
    }

    if (l.zahlungOffen) {
      const wertCent = plausiblerCent(l.wert);
      const rest = wertCent !== null ? wertCent - l.bezahltCent : 0;
      const titel = rest > 0 ? `Durchgeführt, Zahlung offen · ${euroAusCent(rest)} offen` : "Durchgeführt, Zahlung offen";
      neu("zahlung_offen", titel, 2, l.umzugAm ? `${l.umzugAm.slice(0, 10)}T00:00:00Z` : l.angelegtAm);
    }

    if (l.ort === null && (l.status === "neu" || l.status === "kontakt") && alterMs(l.angelegtAm) <= 30 * TAG_MS) {
      neu("adresse_fehlt", "Abholadresse fehlt für den KV", 3, l.angelegtAm);
    }

    if (l.veraltet) {
      neu("stufe_pflegen", `Seit ${alterTage(l.angelegtAm)} Tagen „Neue Anfrage“: Stufe pflegen`, 3, l.angelegtAm);
    }
  }

  return kandidaten
    .sort((a, b) => a.dringlichkeit - b.dringlichkeit || a.anlass - b.anlass || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, MAX_MISSIONEN)
    .map(({ anlass: _anlass, ...mission }) => mission);
}

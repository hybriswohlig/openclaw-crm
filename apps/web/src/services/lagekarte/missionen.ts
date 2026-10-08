/**
 * Lagekarte: Missionen (nächste beste Aktion) nur aus belastbaren Signalen.
 * Reine Funktion, keine DB. Verlorene Leads erzeugen nur „Chat aufräumen“,
 * wenn der Kunde im offenen WhatsApp-Chat zuletzt schrieb (Grok 4).
 * Ruling 14: keine Obergrenze, die Leiste gruppiert nach Art.
 */
import { berlinDateString } from "@/lib/berlin-date";
import { euroAusCent } from "@/lib/lagekarte/farben";
import { kalenderTage } from "@/lib/lagekarte/kalender";
import { abholortFehlt, plausiblerCent, type LeadPunkt, type Mission } from "@/lib/lagekarte/typen";

const TAG_MS = 24 * 60 * 60 * 1000;

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
    const neu = (art: Mission["art"], titel: string, dringlichkeit: Mission["dringlichkeit"], anlassIso: string) =>
      kandidaten.push({
        id: `${art}:${l.id}`,
        art,
        titel,
        leadId: l.id,
        dringlichkeit,
        anlass: new Date(anlassIso).getTime(),
      });

    if (l.status === "verloren") {
      // Kunde schrieb nach „Verloren“ (oder vorher, unbeantwortet): Chat beantworten oder schließen.
      if (l.alterChat) {
        const n = kalenderTage(berlinDateString(new Date(l.alterChat.seit)), heute);
        const wann = n <= 0 ? "heute" : n === 1 ? "gestern" : `vor ${n} Tagen`;
        neu("chat_aufraeumen", `WhatsApp nach Verloren: Kunde schrieb ${wann}`, 3, l.alterChat.seit);
      }
      continue;
    }

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
      const rest = wertCent !== null ? wertCent - l.bezahltCent : null;
      // M-3: decken die Zahlungen den Wert, fehlt nur noch die Stufe.
      const titel =
        rest === null
          ? "Durchgeführt, Zahlung offen"
          : rest > 0
            ? `Durchgeführt, Zahlung offen · ${euroAusCent(rest)} offen`
            : "Zahlung erfasst, Stufe auf „Bezahlt“ setzen";
      neu("zahlung_offen", titel, 2, l.umzugAm ? `${l.umzugAm.slice(0, 10)}T00:00:00Z` : l.angelegtAm);
    }

    if (abholortFehlt(l) && (l.status === "neu" || l.status === "kontakt") && alterMs(l.angelegtAm) <= 30 * TAG_MS) {
      const titel = l.ort ? "Abholadresse fehlt für den KV, nur Ziel bekannt" : "Abholadresse fehlt für den KV";
      neu("adresse_fehlt", titel, 3, l.angelegtAm);
    }

    if (l.veraltet) {
      neu("stufe_pflegen", `Seit ${alterTage(l.angelegtAm)} Tagen „Neue Anfrage“: Stufe pflegen`, 3, l.angelegtAm);
    }

    // Ruling 9: offene WhatsApp-Frage älter als 14 Tage wartet nicht mehr, sie gehört aufgeräumt.
    if (l.alterChat) {
      neu("chat_aufraeumen", `WhatsApp seit ${alterTage(l.alterChat.seit)} Tagen offen: antworten oder Chat schließen`, 3, l.alterChat.seit);
    }
  }

  return kandidaten
    .sort((a, b) => a.dringlichkeit - b.dringlichkeit || a.anlass - b.anlass || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(({ anlass: _anlass, ...mission }) => mission);
}

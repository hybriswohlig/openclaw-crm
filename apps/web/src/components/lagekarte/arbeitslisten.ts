/**
 * Lagekarte: Arbeitslisten der Leiste (Wartet, E-Mails, Heute, Ohne Ort,
 * Missionen) als reine Funktionen.
 *
 * Ruling 13: Die Arbeitslisten bauen auf ALLEN Leads auf (nur verlorene fallen
 * raus); Kartenfilter (Status, Wartet-Chip, Firma, Zeitraum, Wert, Suche)
 * wirken nur auf Karte und Tab „Alle“. So stimmen Tabs und HUD überein.
 * Ruling 14: Missionen werden je Art gruppiert, nichts wird abgeschnitten.
 */
import { berlinDateString } from "@/lib/berlin-date";
import { plusTage } from "@/lib/lagekarte/kalender";
import { abholortFehlt, type LeadPunkt, type Mission, type MissionArt } from "@/lib/lagekarte/typen";

export type WartenderLead = LeadPunkt & { wartet: NonNullable<LeadPunkt["wartet"]> };

export interface Arbeitslisten {
  /** Wartende, wer am längsten wartet zuerst. */
  wartend: WartenderLead[];
  /** Ungelesene E-Mails (Antwortstatus unbekannt), meiste zuerst. */
  emailUngelesen: LeadPunkt[];
  /** Umzug heute oder am nächsten Berliner Kalendertag; Aufträge zuerst. */
  heute: LeadPunkt[];
  /** Ohne verwertbare Adresse, neueste zuerst. */
  ohneOrt: LeadPunkt[];
}

/** Heute und morgen als Berliner Kalendertage (nicht jetzt + 24 h). */
export function heuteUndMorgen(jetzt: Date): { heute: string; morgen: string } {
  const heute = berlinDateString(jetzt);
  return { heute, morgen: plusTage(heute, 1) };
}

function neuesteZuerst(a: LeadPunkt, b: LeadPunkt): number {
  return b.angelegtAm.localeCompare(a.angelegtAm);
}

/** Zweite Zeile im Tab „Ohne Ort“. */
export function ohneOrtHinweis(lead: Pick<LeadPunkt, "ort">): string {
  return lead.ort ? `nur Ziel bekannt: ${lead.ort.ortsname}` : "keine Adresse";
}

export function arbeitslisten(alle: readonly LeadPunkt[], jetzt: Date): Arbeitslisten {
  const aktive = alle.filter((l) => l.status !== "verloren");
  const { heute, morgen } = heuteUndMorgen(jetzt);
  const rang = (l: LeadPunkt) => (l.status === "auftrag" || l.status === "erledigt" ? 0 : 1);
  return {
    wartend: aktive
      .filter((l): l is WartenderLead => l.wartet !== null)
      .sort((a, b) => a.wartet.seit.localeCompare(b.wartet.seit)),
    emailUngelesen: aktive.filter((l) => l.emailUngelesen > 0).sort((a, b) => b.emailUngelesen - a.emailUngelesen),
    heute: aktive
      .filter((l) => l.umzugAm === heute || l.umzugAm === morgen)
      .sort(
        (a, b) =>
          rang(a) - rang(b) || (a.umzugAm ?? "").localeCompare(b.umzugAm ?? "") || a.name.localeCompare(b.name, "de"),
      ),
    // M-2: auch Leads, die nur am Ziel stehen (Abholadresse fehlt für den KV).
    ohneOrt: aktive.filter(abholortFehlt).sort(neuesteZuerst),
  };
}

/* ───────────── Missionen ───────────── */

export const MISSION_ART_LABEL: Record<MissionArt, string> = {
  auftrag_stufe: "Stufe nach Annahme setzen",
  termin_ohne_auftrag: "Termin ohne Auftrag",
  kv_nachfassen: "KV nachfassen",
  zahlung_offen: "Zahlung offen",
  wert_pruefen: "Wert prüfen",
  adresse_fehlt: "Adresse fehlt",
  stufe_pflegen: "Stufe pflegen",
  chat_aufraeumen: "Chat aufräumen",
};

/** Reihenfolge der Arten bei gleicher Dringlichkeit. */
const ART_REIHENFOLGE: MissionArt[] = [
  "auftrag_stufe",
  "termin_ohne_auftrag",
  "kv_nachfassen",
  "zahlung_offen",
  "wert_pruefen",
  "adresse_fehlt",
  "stufe_pflegen",
  "chat_aufraeumen",
];

export interface MissionGruppe {
  art: MissionArt;
  label: string;
  /** Dringlichste Mission der Gruppe (1 = dringend). */
  dringlichkeit: Mission["dringlichkeit"];
  /** Alle Fälle dieser Art in der Reihenfolge des Servers. */
  missionen: Mission[];
}

/**
 * Missionen je Art, Arten nach Dringlichkeit (dann feste Reihenfolge). Missionen
 * zu Leads, die nicht (mehr) in den Daten stehen, fallen weg.
 */
export function gruppiereMissionen(missionen: readonly Mission[], leadIds: ReadonlySet<string>): MissionGruppe[] {
  const gruppen = new Map<MissionArt, MissionGruppe>();
  for (const m of missionen) {
    if (!leadIds.has(m.leadId)) continue;
    const g = gruppen.get(m.art);
    if (g) {
      g.missionen.push(m);
      if (m.dringlichkeit < g.dringlichkeit) g.dringlichkeit = m.dringlichkeit;
    } else {
      gruppen.set(m.art, { art: m.art, label: MISSION_ART_LABEL[m.art], dringlichkeit: m.dringlichkeit, missionen: [m] });
    }
  }
  return [...gruppen.values()].sort(
    (a, b) => a.dringlichkeit - b.dringlichkeit || ART_REIHENFOLGE.indexOf(a.art) - ART_REIHENFOLGE.indexOf(b.art),
  );
}

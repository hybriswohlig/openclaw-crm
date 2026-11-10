/**
 * Zustand des Kottke-KV auf der Kalkulationsseite (Plan 5a, Entscheidung 8):
 * reine Logik für Sperrbereich, KV-Vorschau und das Nachladen der Seite.
 * Keine Gedankenstriche in Texten.
 */
import type { KvErzeugung } from "@/lib/angebot-wahl";
import { berlinTag, tagKurz, uhrzeitKurz } from "@/lib/anzeige";
import type { KalkulationsAnsicht } from "@/lib/kalkulations-ansicht";
import { jobFehlerText } from "@/lib/dokument-angaben";

/** Nachladen, solange der VPS rechnet: sparsam, der Abschluss kommt meist über das Event. */
export const KV_NACHLADEN_MS = 20_000;
/** Ab hier gilt ein laufender Job als hängend: „KV neu erstellen“ wird wieder angeboten. */
export const KV_LANGE_MS = 15 * 60 * 1000;
/** Browser-Event nach dem Ablegen eines Dokuments (GenerateDocumentDialog, Hintergrund-Jobs). */
export const DOKUMENT_ABGELEGT_EVENT = "crm-deal-document-stored";

type Version = Pick<KalkulationsAnsicht["version"], "status" | "kvErzeugung" | "kvDokument" | "kvErstellbar">;

export interface KvStatusAnzeige {
  ton: "blau" | "jade" | "gold" | "rose";
  text: string;
  /** Link „KV öffnen“ auf dieses Dokument */
  dokumentId: string | null;
  /** Job scheiterte an fehlenden Angaben am Lead: Link „Angaben ergänzen“ in die Akte. */
  angabenFehlen?: boolean;
}

/** „09:15“ am selben Berliner Tag, sonst „Di 03.11. 09:15“. */
function seitText(iso: string, jetzt: Date): string {
  const heute = berlinTag(jetzt.toISOString());
  return berlinTag(iso) === heute ? uhrzeitKurz(iso) : `${tagKurz(iso)} ${uhrzeitKurz(iso)}`;
}

/** Läuft der Job schon ungewöhnlich lange? */
export function kvLaeuftLange(e: KvErzeugung, jetzt: Date): boolean {
  if (e.art !== "laeuft") return false;
  const seit = new Date(e.seit).getTime();
  return Number.isFinite(seit) && jetzt.getTime() - seit >= KV_LANGE_MS;
}

/**
 * Was der Sperrbereich einer gesperrten Version über den KV sagt; null, wenn
 * es nichts zu sagen gibt (Entwurf, oder kein Job und kein Dokument).
 */
export function kvStatus(version: Version, jetzt: Date): KvStatusAnzeige | null {
  if (version.status !== "gesperrt") return null;
  const e = version.kvErzeugung;
  switch (e.art) {
    case "laeuft":
      return {
        ton: "blau",
        text: kvLaeuftLange(e, jetzt)
          ? `KV wird erzeugt, gestartet ${seitText(e.seit, jetzt)}. Das dauert ungewöhnlich lange; du kannst den KV neu erstellen.`
          : `KV wird erzeugt, gestartet ${seitText(e.seit, jetzt)}. Die Seite aktualisiert sich von selbst.`,
        dokumentId: null,
      };
    case "fertig":
      return { ton: "jade", text: `KV erstellt: ${e.fileName}`, dokumentId: e.dealDocumentId };
    case "verworfen":
      return {
        ton: "gold",
        text: "KV veraltet, neu erstellen. Das PDF passte beim Eintreffen nicht mehr zum Angebot und wurde verworfen.",
        dokumentId: null,
      };
    case "fehler":
      // Der Text kommt übersetzt vom Dienst (`kvFehlerText`); bei fehlenden Angaben der Link in die Akte.
      return { ton: "rose", text: e.text, dokumentId: null, angabenFehlen: jobFehlerText(e.text, "KV").angabenFehlen };
    case "keins":
      return version.kvDokument
        ? { ton: "jade", text: `KV erstellt: ${version.kvDokument.fileName}`, dokumentId: version.kvDokument.id }
        : null;
  }
}

/**
 * Knopf zum Erzeugen des KV: nur bei `kvErstellbar` und nicht, solange ein Job
 * läuft (außer er hängt). Beschriftung „KV neu erstellen“ nach verworfen,
 * Fehler oder hängendem Job.
 */
export function kvKnopf(version: Version, jetzt: Date): string | null {
  if (version.status !== "gesperrt" || !version.kvErstellbar) return null;
  const e = version.kvErzeugung;
  if (e.art === "laeuft") return kvLaeuftLange(e, jetzt) ? "KV neu erstellen" : null;
  return e.art === "verworfen" || e.art === "fehler" ? "KV neu erstellen" : "KV erstellen";
}

/** Kurze Marke neben „So steht es im KV“. */
export function kvMarke(e: KvErzeugung): { ton: "blau" | "jade" | "gold" | "rose"; text: string } | null {
  switch (e.art) {
    case "laeuft":
      return { ton: "blau", text: "PDF wird erzeugt" };
    case "fertig":
      return { ton: "jade", text: "PDF abgelegt" };
    case "verworfen":
      return { ton: "gold", text: "PDF veraltet" };
    case "fehler":
      return { ton: "rose", text: "PDF fehlgeschlagen" };
    case "keins":
      return null;
  }
}

/**
 * Betrifft ein `crm-deal-document-stored` diesen Deal? Der alte Dialog schickt
 * die Deal-ID als `detail`; ohne erkennbaren Deal lieber nachladen.
 */
export function eventBetrifftDeal(detail: unknown, dealId: string): boolean {
  if (typeof detail === "string") return detail === dealId;
  if (detail && typeof detail === "object") {
    const d = detail as Record<string, unknown>;
    const id = d.dealRecordId ?? d.dealId;
    if (typeof id === "string") return id === dealId;
  }
  return true;
}

/**
 * Wartet-Signal eines offenen Deals: wartet er auf uns, auf den Kunden oder
 * auf niemanden, seit wann und warum. Reine Funktion; die Eingaben lädt
 * services/wartet.ts, das Ergebnis landet in deal_workflow_state.
 * Alle Zeitrechnung in UTC-Millisekunden.
 */

export type StageCategory =
  | "open_new"
  | "open_engaged"
  | "quoted"
  | "booked"
  | "done_unpaid"
  | "paid"
  | "lost"
  | "kein_lead";

export interface WartetEingabe {
  stageCategory: StageCategory | null;
  erstelltAm: Date;
  letzteKundenNachricht: Date | null;
  letzteEigeneNachricht: Date | null;
  kvGesendetAm: Date | null;
  kvZuletztGeoeffnetAm: Date | null;
  angenommenAm: Date | null;
  abErstelltAm: Date | null;
  rechnungErstelltAm: Date | null;
  bezahlt: boolean;
  jetzt: Date;
}

export interface WartetErgebnis {
  auf: "uns" | "kunde" | "niemand";
  seit: Date | null;
  grund: string | null;
}

const TAG_MS = 24 * 60 * 60 * 1000;
/** Ein KV, der länger als so lange ungeöffnet ist, braucht einen Anstoß von uns. */
const KV_UNGESEHEN_MS = 3 * TAG_MS;

const ENDSTUFEN: ReadonlySet<StageCategory> = new Set<StageCategory>(["paid", "lost", "kein_lead"]);

const NIEMAND: WartetErgebnis = { auf: "niemand", seit: null, grund: null };

/** Deal-Id, für die sich eine Berechnung lohnt; null, undefined und "" ergeben null. */
export function berechenbareDealId(id: string | null | undefined): string | null {
  return id ? id : null;
}

/**
 * Regeln in fester Reihenfolge, die erste passende gewinnt:
 * (1) Endstufe → niemand. (2) Kunde schrieb zuletzt → uns. (3) Neue Anfrage
 * ohne eigene Nachricht → uns. (4) KV raus: ungesehen über 3 Tage → uns,
 * sonst → Kunde. (5) Gebucht ohne AB → uns. (6) Durchgeführt: ohne Rechnung
 * → uns, mit Rechnung → Kunde (voll bezahlt → niemand). (7) Sonst → Kunde,
 * wenn wir zuletzt geschrieben haben, sonst niemand.
 */
export function berechneWartet(e: WartetEingabe): WartetErgebnis {
  const kategorie = e.stageCategory;
  if (kategorie && ENDSTUFEN.has(kategorie)) return NIEMAND;

  const kunde = e.letzteKundenNachricht;
  const eigene = e.letzteEigeneNachricht;
  if (kunde && (!eigene || kunde.getTime() > eigene.getTime())) {
    return { auf: "uns", seit: kunde, grund: "Kunde wartet auf Antwort" };
  }

  if (kategorie === "open_new" && !eigene) {
    return { auf: "uns", seit: e.erstelltAm, grund: "Noch keine Antwort" };
  }

  if (kategorie === "quoted") {
    const gesendet = e.kvGesendetAm;
    // Ein Portalbesuch vor dem Versand hat diesen KV nicht gezeigt.
    const geoeffnet =
      !!gesendet && !!e.kvZuletztGeoeffnetAm && e.kvZuletztGeoeffnetAm.getTime() >= gesendet.getTime();
    if (gesendet && !geoeffnet) {
      const alterMs = e.jetzt.getTime() - gesendet.getTime();
      if (alterMs > KV_UNGESEHEN_MS) {
        const tage = Math.floor(alterMs / TAG_MS);
        return { auf: "uns", seit: gesendet, grund: `KV seit ${tage} Tagen ungesehen` };
      }
    }
    return { auf: "kunde", seit: gesendet, grund: "KV offen" };
  }

  if (kategorie === "booked" && !e.abErstelltAm) {
    return { auf: "uns", seit: e.angenommenAm, grund: "AB fehlt" };
  }

  if (kategorie === "done_unpaid") {
    if (!e.rechnungErstelltAm) {
      return { auf: "uns", seit: e.angenommenAm ?? e.erstelltAm, grund: "Rechnung fehlt" };
    }
    if (e.bezahlt) return NIEMAND;
    return { auf: "kunde", seit: e.rechnungErstelltAm, grund: "Rechnung offen" };
  }

  if (eigene) return { auf: "kunde", seit: eigene, grund: "Wartet auf Kunden" };
  return NIEMAND;
}

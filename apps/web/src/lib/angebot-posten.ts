/**
 * Posten im Body, wenn ein Formular das Angebot speichert
 * (PUT /api/v1/deals/:id/quotation): Kostenrechner (QuotationCalculator) und
 * Status-Link-Assistent.
 *
 * upsertQuotation ersetzt alle Posten, sobald lineItems im Body steht, auch
 * bei []; fehlt das Feld, bleiben sie stehen. Beim Festpreis tragen die Posten
 * die Aufschlüsselung aus „In Angebot übernehmen“ (Kern + Hebel, Summe =
 * Festpreis), die beide Formulare gar nicht anzeigen. Bis 2026-10-08 schickten
 * sie beim Festpreis immer [] und löschten die Aufschlüsselung bei jedem
 * Speichern; der KV zeigte danach nur noch eine Zeile „Pauschale“. Ändert
 * jemand den Festpreis, rechnet postenAnNeuenFestpreisAnpassen den Kern neu.
 */

/** Ein Posten, so wie ihn PUT /api/v1/deals/:id/quotation annimmt. */
export interface Posten {
  type: "helper" | "transporter" | "other";
  description: string | null;
  quantity: number;
  unitRate: string;
  sortOrder: number;
}

/** Stand des Angebots, als das Formular geladen wurde. */
export interface GeladenesAngebot {
  isVariable: boolean;
  fixedPrice: string | null;
  /** Posten aus dem GET; weitere Felder (id, quotationId, …) sind erlaubt und werden nicht weitergereicht. */
  lineItems: ReadonlyArray<Posten>;
}

/** Kern darf höchstens bis zu diesem Anteil am Festpreis schrumpfen (wie KERN_MIN_ANTEIL im KV). */
const KERN_MIN_ANTEIL = 0.5;

/** Betrag in Cent; null ohne Betrag, NaN bei unlesbarer Eingabe (ist nie gleich). */
function inCent(betrag: string | null): number | null {
  if (betrag === null || betrag.trim() === "") return null;
  const zahl = Number(betrag);
  return Number.isFinite(zahl) ? Math.round(zahl * 100) : Number.NaN;
}

/**
 * Passt die Aufschlüsselung an einen neuen Festpreis an: Der Kern (erster
 * Posten nach sortOrder) ist der Rest, die Hebel bleiben, so ergeben die
 * Posten wieder genau den Festpreis. Gerechnet wird in Cent, jeder Hebel
 * (Menge mal Einzelpreis) für sich gerundet, wie bei postenErgebenFestpreis.
 * Wird der Kern negativ oder kleiner als die Hälfte des Festpreises (wie im
 * KV), bleibt nur der Kern mit dem ganzen Festpreis. Der Aufrufer sorgt für
 * einen lesbaren Festpreis über 0.
 */
export function postenAnNeuenFestpreisAnpassen(posten: ReadonlyArray<Posten>, festpreis: string): Posten[] {
  // Nur die Felder von Posten: GET liefert auch id, quotationId, createdAt.
  const sortiert: Posten[] = [...posten]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((p) => ({ type: p.type, description: p.description, quantity: p.quantity, unitRate: p.unitRate, sortOrder: p.sortOrder }));
  const [kern, ...hebel] = sortiert;
  if (!kern) return [];
  const festpreisCent = Math.round(Number(festpreis) * 100);
  const hebelCent = hebel.reduce((s, p) => s + Math.round(Number(p.unitRate) * p.quantity * 100), 0);
  const kernCent = festpreisCent - hebelCent;
  const nurKern = kernCent < 0 || kernCent < festpreisCent * KERN_MIN_ANTEIL || hebel.length === 0;
  const neuerKern = (cent: number): Posten => ({ ...kern, quantity: 1, unitRate: (cent / 100).toFixed(2) });
  return nurKern ? [neuerKern(festpreisCent)] : [neuerKern(kernCent), ...hebel];
}

/**
 * Stundensatz: die Posten aus dem Formular, neu durchnummeriert (wie bisher).
 *
 * Festpreis: das Feld bleibt weg, solange Modus und Festpreis dem geladenen
 * Angebot entsprechen ("1720" und "1720.00" sind gleich). [] geht nur mit, wenn
 * jemand den Festpreis geändert oder vom Stundensatz gewechselt hat, denn dann
 * passt die alte Aufschlüsselung nicht mehr: Beim geänderten Festpreis wird der
 * Kern der geladenen Posten angepasst, beim Wechsel vom Stundensatz, ohne
 * geladene Posten oder bei unlesbarem Festpreis gehen [] mit. Ohne geladenes Angebot (neu oder
 * Laden fehlgeschlagen) bleibt das Feld ebenfalls weg: was das Formular nicht
 * kennt, darf es nicht löschen.
 */
export function postenFuerSpeichern<P extends object>(eingabe: {
  isVariable: boolean;
  /** Festpreis genau so, wie er im Body steht */
  fixedPrice: string | null;
  /** Posten im Formular; zählen nur beim Stundensatz */
  lineItems: readonly P[];
  geladen: GeladenesAngebot | null;
}): { lineItems?: Array<(P & { sortOrder: number }) | Posten> } {
  if (eingabe.isVariable) {
    return { lineItems: eingabe.lineItems.map((li, i) => ({ ...li, sortOrder: i })) };
  }
  const { geladen } = eingabe;
  if (!geladen) return {};
  const unveraendert = !geladen.isVariable && inCent(geladen.fixedPrice) === inCent(eingabe.fixedPrice);
  if (unveraendert) return {};
  const neu = inCent(eingabe.fixedPrice);
  const kannAnpassen = !geladen.isVariable && geladen.lineItems.length > 0 && neu !== null && Number.isFinite(neu) && neu > 0;
  return { lineItems: kannAnpassen ? postenAnNeuenFestpreisAnpassen(geladen.lineItems, eingabe.fixedPrice as string) : [] };
}

/**
 * Gespeichertes Angebot aus der Antwort von GET oder PUT
 * /api/v1/deals/:id/quotation ({ data }), sonst null. Formulare, die offen
 * bleiben, nehmen es nach jedem Speichern als neuen Vergleichsstand für
 * postenFuerSpeichern; sonst vergleicht ein zweites Speichern mit dem Stand
 * beim Laden: 1000 laden, 1100 speichern, zurück auf 1000 sähe „unverändert“
 * aus, und die Posten zu 1100 blieben stehen.
 */
export function angebotAusAntwort<T extends GeladenesAngebot>(json: unknown): T | null {
  const data = (json as { data?: unknown } | null | undefined)?.data;
  if (!data || typeof data !== "object") return null;
  const a = data as Partial<GeladenesAngebot>;
  return typeof a.isVariable === "boolean" && Array.isArray(a.lineItems) ? (data as T) : null;
}

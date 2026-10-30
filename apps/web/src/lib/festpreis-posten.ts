/**
 * Posten beim Festpreis: KV und AB drucken die Aufschlüsselung nur, wenn die
 * bepreisten Posten zusammen genau den Festpreis ergeben (Kern + Hebel aus
 * „In Angebot übernehmen“). Sonst steht dort eine einzige Zeile „Pauschale“,
 * damit Posten und Gesamtbetrag nie auseinanderlaufen.
 *
 * Die Regel steht nur hier. Der Preisblock für den Renderer
 * (preiseFromQuotation), der Hinweis im Fenster „Es fehlen noch Angaben“
 * (loadKvHinweise) und die AB aus dem angenommenen Angebot
 * (preisQuelleAusAnnahme) rechnen damit, sonst sagt der Hinweis etwas
 * anderes, als im Dokument steht.
 */

/** Euro in Cent; Unlesbares zählt 0. */
function inCent(euro: number): number {
  return Number.isFinite(euro) ? Math.round(euro * 100) : 0;
}

/**
 * Posten mit einem Preis ungleich 0, einschließlich eines Rabatts (negativer
 * Einzelpreis). Null und Unlesbares zählen nicht.
 */
export function istBepreist(posten: { unitRate: string }): boolean {
  const rate = Number(posten.unitRate);
  return Number.isFinite(rate) && rate !== 0;
}

/**
 * Ergeben die bepreisten Posten zusammen genau den Festpreis? Gerechnet wird
 * in Cent, jeder Posten (Menge mal Einzelpreis) für sich gerundet.
 */
export function postenErgebenFestpreis(
  posten: ReadonlyArray<{ quantity: number; unitRate: string }>,
  festpreis: string
): boolean {
  const summe = posten
    .filter(istBepreist)
    .reduce((s, p) => s + inCent(Number(p.unitRate) * p.quantity), 0);
  return summe === inCent(Number(festpreis));
}

/**
 * Druckt der KV den Festpreis als eine einzige Zeile „Pauschale“? Ja, wenn
 * es einen Festpreis gibt, kein Stundensatz mit Helfern und Transporter
 * vorliegt und keine bepreisten Posten da sind oder sie den Festpreis nicht
 * ergeben. Beim variablen Preis ohne Helfer und Transporter stehen die Posten
 * ohne Summenprüfung im KV. Ceylan bekommt immer nur den Betrag; das
 * entscheidet der Aufrufer über die Firma.
 */
export function festpreisAlsPauschale(q: {
  isVariable: boolean;
  fixedPrice: string | null;
  lineItems: ReadonlyArray<{ type: string; quantity: number; unitRate: string }>;
}): boolean {
  if (!q.fixedPrice) return false;
  const stundensatz =
    q.isVariable &&
    q.lineItems.some((li) => li.type === "helper") &&
    q.lineItems.some((li) => li.type === "transporter");
  if (stundensatz) return false;
  const postenGelten =
    q.lineItems.some(istBepreist) &&
    (q.isVariable || postenErgebenFestpreis(q.lineItems, q.fixedPrice));
  return !postenGelten;
}

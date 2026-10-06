/**
 * Rechtstexte der KV-Annahme. Eine Quelle für Dialog, Bestätigungs-Mail,
 * WhatsApp und /legal/widerruf. Änderungen hier ändern alle Stellen.
 */

export const BUTTON_ZAHLUNGSPFLICHTIG = "Zahlungspflichtig beauftragen";

export const HAFTUNGSHINWEIS_451G = {
  titel: "Wichtiger Haftungshinweis nach § 451g HGB",
  absaetze: [
    "Haftung: Wir haften für Verlust oder Beschädigung Ihres Umzugsguts von der Übernahme bis zur Ablieferung nach den gesetzlichen Vorschriften (§§ 425 ff., 451 ff. HGB). Die Haftung ist nach § 451e HGB auf 620 Euro je Kubikmeter Laderaum begrenzt, der zur Erfüllung des Vertrags benötigt wird.",
    "Ihre Möglichkeiten: Sie können mit uns eine weitergehende Haftung gegen Aufpreis vereinbaren oder Ihr Umzugsgut zum tatsächlichen Wert versichern (Umzugs- oder Transportversicherung). Sprechen Sie uns dafür vor dem Umzug an.",
    "Schadensanzeige: Äußerlich erkennbare Schäden zeigen Sie uns bitte spätestens am Tag nach der Ablieferung an, äußerlich nicht erkennbare Schäden innerhalb von 14 Tagen nach der Ablieferung, jeweils in Textform (zum Beispiel per E-Mail oder WhatsApp). Wird die Frist versäumt, erlischt der Anspruch (§ 451f HGB).",
  ],
} as const;

export const HAFTUNG_CHECKBOX = "Ich habe den Haftungshinweis nach § 451g HGB gelesen.";
export const VERSICHERUNG_CHECKBOX =
  "Ich möchte ein Angebot für eine weitergehende Haftung oder eine Transportversicherung (freiwillig).";
export const VORZEITIGER_BEGINN_CHECKBOX =
  "Ich verlange ausdrücklich, dass Sie vor Ende der Widerrufsfrist mit der Leistung beginnen. Mir ist bekannt, dass ich bei einem Widerruf einen angemessenen Betrag für die bis dahin erbrachten Leistungen zahle und dass mein Widerrufsrecht erlischt, sobald die Leistung vollständig erbracht ist.";

export function keinWiderrufHinweis(): string {
  return "Für Umzugsaufträge mit festem Termin besteht kein gesetzliches Widerrufsrecht (§ 312g Abs. 2 Satz 1 Nr. 9 BGB). Sie können den Auftrag jederzeit kündigen. Dann gilt § 9 unserer AGB.";
}

export interface FirmaKontakt {
  firma: string;
  inhaber: string;
  strasse: string;
  ort: string;
  telefon: string | null;
  email: string | null;
}

const KONTAKT: Record<string, FirmaKontakt> = {
  kottke: { firma: "Kottke Dienstleistungen", inhaber: "Darioush Kottke", strasse: "Marktstr. 8", ort: "72218 Wildberg", telefon: "+49 175 9498475", email: null },
  ceylan: { firma: "Ceylan Umzüge & Transporte", inhaber: "Nurullah Ceylan", strasse: "Kapellenberg 13", ort: "72218 Wildberg", telefon: null, email: "info@ceylan-operations.de" },
};

export function firmaKontakt(slug: string): FirmaKontakt {
  return KONTAKT[slug] ?? KONTAKT.kottke;
}

function kontaktZeile(k: FirmaKontakt): string {
  return [
    `${k.firma}, Inhaber ${k.inhaber}, ${k.strasse}, ${k.ort}`,
    k.telefon ? `Telefon ${k.telefon}` : null,
    k.email ? `E-Mail ${k.email}` : null,
  ].filter(Boolean).join(", ");
}

/** Muster nach Anlage 1 zu Art. 246a § 1 Abs. 2 S. 2 EGBGB, Dienstleistung. */
export function widerrufsbelehrung(k: FirmaKontakt): { titel: string; absaetze: string[] } {
  return {
    titel: "Widerrufsbelehrung",
    absaetze: [
      "Widerrufsrecht",
      "Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen.",
      "Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsabschlusses.",
      `Um Ihr Widerrufsrecht auszuüben, müssen Sie uns (${kontaktZeile(k)}) mittels einer eindeutigen Erklärung (z. B. ein mit der Post versandter Brief oder E-Mail) über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren. Sie können dafür das beigefügte Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist.`,
      "Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung über die Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist absenden.",
      "Folgen des Widerrufs",
      "Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von Ihnen erhalten haben, einschließlich der Lieferkosten (mit Ausnahme der zusätzlichen Kosten, die sich daraus ergeben, dass Sie eine andere Art der Lieferung als die von uns angebotene, günstigste Standardlieferung gewählt haben), unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über Ihren Widerruf dieses Vertrags bei uns eingegangen ist. Für diese Rückzahlung verwenden wir dasselbe Zahlungsmittel, das Sie bei der ursprünglichen Transaktion eingesetzt haben, es sei denn, mit Ihnen wurde ausdrücklich etwas anderes vereinbart; in keinem Fall werden Ihnen wegen dieser Rückzahlung Entgelte berechnet.",
      "Haben Sie verlangt, dass die Dienstleistungen während der Widerrufsfrist beginnen sollen, so haben Sie uns einen angemessenen Betrag zu zahlen, der dem Anteil der bis zu dem Zeitpunkt, zu dem Sie uns von der Ausübung des Widerrufsrechts hinsichtlich dieses Vertrags unterrichten, bereits erbrachten Dienstleistungen im Vergleich zum Gesamtumfang der im Vertrag vorgesehenen Dienstleistungen entspricht.",
    ],
  };
}

export function musterWiderrufsformular(k: FirmaKontakt): string[] {
  return [
    "Muster-Widerrufsformular",
    "(Wenn Sie den Vertrag widerrufen wollen, dann füllen Sie bitte dieses Formular aus und senden Sie es zurück.)",
    `An ${kontaktZeile(k)}:`,
    "Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag über die Erbringung der folgenden Dienstleistung (*)",
    "Bestellt am (*)",
    "Name des/der Verbraucher(s)",
    "Anschrift des/der Verbraucher(s)",
    "Unterschrift des/der Verbraucher(s) (nur bei Mitteilung auf Papier)",
    "Datum",
    "(*) Unzutreffendes streichen.",
  ];
}

export function abschlussHinweis(firmaName: string): string {
  return `Mit Klick auf „${BUTTON_ZAHLUNGSPFLICHTIG}“ nehmen Sie unser Angebot verbindlich an. Damit kommt der Vertrag mit ${firmaName} zustande. Die Bestätigung mit dem Angebot erhalten Sie per WhatsApp oder E-Mail. Zur Dokumentation speichern wir Zeitpunkt, IP-Adresse und Browser-Kennung.`;
}

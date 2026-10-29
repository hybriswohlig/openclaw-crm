/**
 * Texte zum Sperren des Kunden-Links. Läuft noch eine Widerrufsfrist, verliert
 * der Kunde mit dem gesperrten Link den Widerrufsbutton (§ 356a BGB). Einen
 * neuen Link für denselben Auftrag gibt es nicht, nur Re-aktivieren.
 */
function datumDe(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}.${m}.${y}`;
}

export function sperrBestaetigungText(widerrufBis: string | null): string {
  const frage = "Soll der Kunden-Link wirklich gesperrt werden? Bestehende Bestätigungen bleiben erhalten.";
  if (!widerrufBis) return frage;
  return (
    `Achtung: Der Kunde kann diesen Vertrag noch bis ${datumDe(widerrufBis)} widerrufen. ` +
    "Mit dem gesperrten Link verliert er den Widerrufsbutton. Sperren Sie nur, wenn der Link in falsche Hände geraten ist, " +
    "und nehmen Sie einen Widerruf dann per E-Mail oder WhatsApp entgegen. Sonst danach wieder Re-aktivieren.\n\n" +
    frage
  );
}

/** Hinweis neben „Gesperrt“, solange die Frist läuft. */
export function gesperrtHinweis(widerrufBis: string | null): string | null {
  if (!widerrufBis) return null;
  return `Widerrufsfrist läuft bis ${datumDe(widerrufBis)}: Ohne Link hat der Kunde keinen Widerrufsbutton.`;
}

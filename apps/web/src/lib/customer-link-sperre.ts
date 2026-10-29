/**
 * Texte zum Sperren und Erneuern des Kunden-Links. Läuft noch eine
 * Widerrufsfrist, verliert der Kunde mit dem gesperrten Link den
 * Widerrufsbutton (§ 356a BGB). Für einen weitergegebenen Link ist deshalb
 * „Neuer Link“ der richtige Weg: Der alte Link geht nicht mehr, der Kunde
 * bekommt den neuen.
 */
function datumDe(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}.${m}.${y}`;
}

export function sperrBestaetigungText(widerrufBis: string | null): string {
  const frage = "Soll der Kunden-Link wirklich gesperrt werden? Bestehende Bestätigungen bleiben erhalten.";
  if (!widerrufBis) return frage;
  return (
    `Achtung: Der Kunde kann diesen Vertrag voraussichtlich noch bis einschließlich ${datumDe(widerrufBis)} widerrufen. ` +
    "Solange der Link gesperrt ist, hat er keinen Widerrufsbutton. " +
    "Ist der Link in falsche Hände geraten, nehmen Sie besser „Neuer Link“ und schicken dem Kunden den neuen.\n\n" +
    frage
  );
}

/** Hinweis neben „Gesperrt“, solange die Frist läuft. */
export function gesperrtHinweis(widerrufBis: string | null): string | null {
  if (!widerrufBis) return null;
  return (
    `Widerrufsfrist läuft voraussichtlich bis einschließlich ${datumDe(widerrufBis)}. ` +
    "Solange der Link gesperrt ist, hat der Kunde keinen Widerrufsbutton. Erstellen Sie einen neuen Link oder aktivieren Sie diesen wieder."
  );
}

export function neuerLinkBestaetigung(): string {
  return "Der bisherige Link funktioniert danach nicht mehr. Schicken Sie dem Kunden den neuen Link. Neuen Link erstellen?";
}

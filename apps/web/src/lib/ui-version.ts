/** Gespeicherte Oberfläche: die bestehende Ansicht oder die neue. */
export type UiVersion = "alt" | "neu";

/** `null`, wenn der Wert weder `alt` noch `neu` ist. */
export function normalizeUiVersion(input: unknown): UiVersion | null {
  if (input === "alt" || input === "neu") return input;
  return null;
}

/**
 * Einstieg in die alte Oberfläche für `/start` und den Umschalter „Zur alten Oberfläche“.
 * Seit dem Löschen von `/home` (18.11.) ist das die alte Inbox, die wichtigste alte Seite,
 * die es noch gibt. Nie eine gelöschte Seite (Test in `ui-version.test.ts`). Mit `alt=1`,
 * damit ein veralteter Spiegel-Cookie `crm_ui=neu` nicht gleich in die neue Inbox umleitet.
 */
export const ALTE_STARTSEITE = "/inbox?alt=1";

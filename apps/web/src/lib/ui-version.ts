/** Gespeicherte Oberfläche: die bestehende Ansicht oder die neue. */
export type UiVersion = "alt" | "neu";

/** `null`, wenn der Wert weder `alt` noch `neu` ist. */
export function normalizeUiVersion(input: unknown): UiVersion | null {
  if (input === "alt" || input === "neu") return input;
  return null;
}

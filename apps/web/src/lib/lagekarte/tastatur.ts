/**
 * Lagekarte: Tastenkürzel (/, j, k, 3) nur, wenn gerade kein Eingabefeld den Fokus hat.
 */
export function istEingabeAktiv(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return el.getAttribute("role") === "textbox";
}

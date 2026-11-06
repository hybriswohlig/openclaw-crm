/**
 * Notizen als reiner Text (Plan 3, Task 13): die alte Oberfläche speichert
 * TipTap-JSON (`editor.getJSON()`); hier hin und zurück, ohne React.
 */

/** Knoten, deren Kinder mit Zeilenumbruch getrennt werden; alle anderen hängen aneinander. */
const BLOCK = new Set(["doc", "bulletList", "orderedList", "blockquote", "listItem", "taskList", "taskItem"]);

/** Reiner Text aus einem TipTap-Dokument; ein String bleibt, wie er ist. */
export function notizText(inhalt: unknown): string {
  if (typeof inhalt === "string") return inhalt;
  if (!inhalt || typeof inhalt !== "object") return "";
  const knoten = inhalt as { type?: string; text?: string; content?: unknown[] };
  if (knoten.type === "hardBreak") return "\n";
  if (typeof knoten.text === "string") return knoten.text;
  if (!Array.isArray(knoten.content)) return "";
  const teile = knoten.content.map(notizText);
  return teile.join(BLOCK.has(knoten.type ?? "") ? "\n" : "");
}

/** Text als TipTap-Dokument, ein Absatz je Zeile, damit die alte Seite ihn bearbeiten kann. */
export function notizDokument(text: string): { type: "doc"; content: unknown[] } {
  return {
    type: "doc",
    content: text.split("\n").map((zeile) =>
      zeile === "" ? { type: "paragraph" } : { type: "paragraph", content: [{ type: "text", text: zeile }] }
    ),
  };
}

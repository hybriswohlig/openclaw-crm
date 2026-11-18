/**
 * Fehler des KV-Editor-Dienstes (Vertrag `lib/kv-editor.ts`: „Fehler als `KvEditorFehlerKlasse`
 * mit `code` aus `KvEditorFehler` und `daten` nach `KvEditorFehlerDaten`“). Die Routen (Aufgabe 5)
 * machen daraus `{ error: { code, message, daten } }` mit `status`.
 */
import {
  KV_EDITOR_STATUS,
  KV_EDITOR_TEXT,
  type KvEditorFehler,
  type KvEditorFehlerAntwort,
  type KvEditorFehlerDaten,
} from "@/lib/kv-editor";

export class KvEditorFehlerKlasse<C extends KvEditorFehler = KvEditorFehler> extends Error {
  readonly status: number;

  constructor(
    readonly code: C,
    message: string = KV_EDITOR_TEXT[code],
    readonly daten?: KvEditorFehlerDaten[C]
  ) {
    super(message);
    this.name = "KvEditorFehlerKlasse";
    this.status = KV_EDITOR_STATUS[code];
  }

  antwort(): KvEditorFehlerAntwort<C> {
    return { error: { code: this.code, message: this.message, ...(this.daten !== undefined ? { daten: this.daten } : {}) } };
  }
}

export function istKvEditorFehler(e: unknown): e is KvEditorFehlerKlasse {
  return e instanceof KvEditorFehlerKlasse;
}

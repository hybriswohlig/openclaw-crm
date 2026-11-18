/**
 * Haken des KV-Editors für neue KVs aus der Kalkulation (Route `/api/tools/run`,
 * `storeCommercialDocument`), Vertrag `KvEditorHaken` in `lib/kv-editor.ts`.
 *
 * STUB aus Aufgabe 0b, damit die Druckwege (Aufgabe 2c) allein bauen: ohne Quelle
 * bleibt jeder neue KV wie heute. Aufgabe 3 ersetzt diese Datei.
 */
import type { DbExecutor } from "@/services/einsatz-personen";
import type { KvAenderung, KvEditorHaken, KvKonflikt, KvStandKopf, KvStandZumNeuenKvEingabe } from "@/lib/kv-editor";

export async function kvEditorBeimNeuenKv(
  _ws: string,
  _deal: string
): Promise<{ quelle: { id: string; aenderungen: KvAenderung[]; offen: KvKonflikt[] } | null }> {
  return { quelle: null };
}

export async function kvEditorStandZumNeuenKv(
  _ex: DbExecutor,
  _ws: string,
  _deal: string,
  _e: KvStandZumNeuenKvEingabe
): Promise<KvStandKopf> {
  throw new Error("kv-editor: Haken noch nicht gebaut");
}

const _vertrag: KvEditorHaken = { kvEditorBeimNeuenKv, kvEditorStandZumNeuenKv };
void _vertrag;

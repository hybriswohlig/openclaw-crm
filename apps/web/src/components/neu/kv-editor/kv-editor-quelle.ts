/**
 * Datenquelle des KV-Editors. Die Oberfläche spricht nur mit dieser Schnittstelle:
 * in Aufgabe 6a mit Testdaten (`kv-editor-fixture.ts`), in 6b mit den Routen aus
 * Aufgabe 5 (`apiQuelle`). Antworten wie `apiAufruf`: `{ ok, data }` oder Fehler
 * mit `code`, `message` und `fehler.daten` (`KvEditorFehlerDaten`).
 */
import { apiAufruf, jsonAufruf, type ApiAntwort } from "@/components/neu/akte/api";
import {
  kvEditorApiPfad,
  type KiAntwort,
  type KonflikteAntwort,
  type KonflikteEingabe,
  type KvChatBeitrag,
  type KvChatEingabe,
  type KvEditorAnsicht,
  type KvStandDetail,
  type KvStandKopf,
  type PushenAntwort,
  type PushenEingabe,
  type StandAnlegenEingabe,
} from "@/lib/kv-editor";

export type { ApiAntwort };

export interface KvEditorQuelle {
  /** GET …/kv-editor */
  ansicht(): Promise<ApiAntwort<KvEditorAnsicht>>;
  /** GET …/staende/<id> (volles Detail: beim Wählen und einmal, wenn ein Druck endet). */
  stand(standId: string): Promise<ApiAntwort<KvStandDetail>>;
  /** GET …/staende/<id>/kopf (schlank, zum Abfragen alle 5 s, solange `druckt`). */
  standKopf(standId: string): Promise<ApiAntwort<KvStandKopf>>;
  /** GET …/staende/<id>/pdf (inline); null, wenn es kein PDF gibt (Testdaten ohne Datei). */
  pdfUrl(standId: string): string | null;
  /** POST …/staende (201): neuer Entwurf, Hand oder KI (`kiNachrichtId`). */
  standAnlegen(e: StandAnlegenEingabe): Promise<ApiAntwort<KvStandKopf>>;
  /** POST …/staende/<id>/neu-drucken (201): neuer Stand mit derselben Liste. */
  neuDrucken(standId: string): Promise<ApiAntwort<KvStandKopf>>;
  /** POST …/staende/<id>/pushen */
  pushen(standId: string, e: PushenEingabe): Promise<ApiAntwort<PushenAntwort>>;
  /** POST …/konflikte */
  konflikte(e: KonflikteEingabe): Promise<ApiAntwort<KonflikteAntwort>>;
  /** POST …/staende/<id>/uebertragen (`KALKULATION_NEU`, Hinweis `quelle_ohne_stand`). */
  uebertragen(standId: string): Promise<ApiAntwort<KvStandKopf>>;
  /** POST …/chat */
  chat(e: KvChatEingabe): Promise<ApiAntwort<KiAntwort>>;
  /** GET …/chat */
  chatVerlauf(): Promise<ApiAntwort<KvChatBeitrag[]>>;
}

/** Zusatzdaten eines Fehlers (`{ error: { code, message, daten } }`). */
export function fehlerDaten(a: ApiAntwort<unknown>): unknown {
  return a.ok ? undefined : (a.fehler as { daten?: unknown } | undefined)?.daten;
}

/**
 * Quelle gegen die Routen aus Plan Aufgabe 5. Die Pfade stehen im Plan; geprüft wird diese
 * Verdrahtung erst in 6b gegen die echten Routen.
 */
export function apiQuelle(dealId: string): KvEditorQuelle {
  const basis = kvEditorApiPfad(dealId);
  const stand = (id: string) => `${basis}/staende/${encodeURIComponent(id)}`;
  return {
    ansicht: () => apiAufruf(basis),
    stand: (id) => apiAufruf(stand(id)),
    standKopf: (id) => apiAufruf(`${stand(id)}/kopf`),
    pdfUrl: (id) => `${stand(id)}/pdf`,
    standAnlegen: (e) => apiAufruf(`${basis}/staende`, jsonAufruf("POST", e)),
    neuDrucken: (id) => apiAufruf(`${stand(id)}/neu-drucken`, jsonAufruf("POST", {})),
    pushen: (id, e) => apiAufruf(`${stand(id)}/pushen`, jsonAufruf("POST", e)),
    konflikte: (e) => apiAufruf(`${basis}/konflikte`, jsonAufruf("POST", e)),
    uebertragen: (id) => apiAufruf(`${stand(id)}/uebertragen`, jsonAufruf("POST", {})),
    chat: (e) => apiAufruf(`${basis}/chat`, jsonAufruf("POST", e)),
    chatVerlauf: () => apiAufruf(`${basis}/chat`),
  };
}

/**
 * KV aus einer gesperrten Kalkulationsversion: Nicht-Kottke rendert sofort
 * über den CRM-Renderer (`storeCommercialDocument`, liest die Quotation, die
 * das Sperren geschrieben hat), Kottke bleibt auf dem VPS-Weg „Dokument
 * erzeugen“ und bekommt nur einen Hinweis (Plan-Entscheidung 1). Das
 * gespeicherte Dokument verknüpft `createDealDocument` mit der Version.
 *
 * Abhängigkeiten sind über `KvAusVersionOptionen` austauschbar; die Vorgaben
 * laden DB-Lader erst beim Aufruf (Tests berühren `@/db` nie).
 */
import type { DocumentCopy } from "@openclaw-crm/document-templates";
import { ohnePreisangaben } from "@/lib/ohne-preisangaben";
import type { DealDocumentMeta } from "@/services/deal-documents";
import type { storeCommercialDocument } from "@/services/commercial-documents";
import { VersionsFehler, type VersionsZeile } from "./kalkulation-versionen";

export type KvAusVersionErgebnis =
  | { renderer: "crm"; document: DealDocumentMeta; fileName: string }
  | { renderer: "vps"; hinweis: string };

export interface KvAusVersionOptionen {
  ladeVersion?: (ws: string, deal: string, version: number) => Promise<Pick<VersionsZeile, "id" | "status"> | null>;
  /** `quotations.calculation_version_id` des Deals. */
  ladeAngebotsVersionId?: (deal: string) => Promise<string | null>;
  /** Betreiberfirma Kottke: CRM-Renderer gesperrt. */
  istKottke?: (ws: string, deal: string) => Promise<boolean>;
  speichereKv?: typeof storeCommercialDocument;
}

async function abhaengigkeiten(o: KvAusVersionOptionen): Promise<Required<KvAusVersionOptionen>> {
  return {
    ladeVersion: o.ladeVersion ?? (await import("./kalkulation-versionen-speicher")).dbVersionsSpeicher.lesen,
    ladeAngebotsVersionId: o.ladeAngebotsVersionId ?? (await import("./deal-documents")).angebotsVersionId,
    istKottke: o.istKottke ?? (await import("@/lib/kottke-crm-renderer-deal")).dealBlocksInRepoCrmRenderer,
    speichereKv: o.speichereKv ?? (await import("./commercial-documents")).storeCommercialDocument,
  };
}

/** Einleitung, Schluss und Bemerkungen ohne Sätze mit Beträgen; leere fallen weg. */
function textOhnePreise(copy: DocumentCopy | undefined): DocumentCopy {
  const aus: DocumentCopy = {};
  for (const feld of ["intro", "closing", "remarks"] as const) {
    const text = copy?.[feld];
    if (typeof text !== "string") continue;
    const rest = ohnePreisangaben(text);
    if (rest) aus[feld] = rest;
  }
  return aus;
}

export async function kvAusVersion(
  input: { workspaceId: string; dealRecordId: string; version: number; copy?: DocumentCopy; updatedBy: string | null },
  optionen: KvAusVersionOptionen = {}
): Promise<KvAusVersionErgebnis> {
  const d = await abhaengigkeiten(optionen);
  const { workspaceId, dealRecordId, version: n } = input;

  const version = await d.ladeVersion(workspaceId, dealRecordId, n);
  if (!version) throw new VersionsFehler("NICHT_GEFUNDEN", `Version v${n} nicht gefunden.`);
  if (version.status !== "gesperrt") {
    throw new VersionsFehler("UNGUELTIG", `Version v${n} ist nicht gesperrt.`);
  }
  if ((await d.ladeAngebotsVersionId(dealRecordId)) !== version.id) {
    throw new VersionsFehler("UNGUELTIG", `Das Angebot wurde nach v${n} von Hand geändert. Neue Version sperren.`);
  }

  if (await d.istKottke(workspaceId, dealRecordId)) {
    return {
      renderer: "vps",
      hinweis: `Kottke-KV über „Dokument erzeugen“ erstellen; die Preise kommen aus Version v${n}.`,
    };
  }

  const gespeichert = await d.speichereKv({
    workspaceId,
    dealRecordId,
    kind: "KV",
    copy: textOhnePreise(input.copy),
    notifyCustomer: false,
    updatedBy: input.updatedBy,
  });
  return { renderer: "crm", document: gespeichert.document, fileName: gespeichert.fileName };
}

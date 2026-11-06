/**
 * KV aus einer gesperrten Kalkulationsversion: Nicht-Kottke rendert sofort
 * über den CRM-Renderer (`storeCommercialDocument`, liest die Quotation, die
 * das Sperren geschrieben hat), Kottke bleibt auf dem VPS-Weg „Dokument
 * erzeugen“ und bekommt nur einen Hinweis (Plan-Entscheidung 1). Gespeichert
 * und mit der Version verknüpft wird der KV nur, wenn die gerenderte Quotation
 * auf genau diese Version zeigt (sonst dieselbe Ablehnung wie vor dem Rendern).
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
  /** Alle Versionen des Deals (nur gelesen, wenn die Quotation nicht auf die Version zeigt). */
  ladeVersionen?: (ws: string, deal: string) => Promise<Pick<VersionsZeile, "version" | "status">[]>;
  /** `quotations.calculation_version_id` des Deals. */
  ladeAngebotsVersionId?: (deal: string) => Promise<string | null>;
  /** Deal hat Paketoptionen: deren Preis überschreibt den Festpreis der Version. */
  hatPakete?: (deal: string) => Promise<boolean>;
  /** Betreiberfirma Kottke: CRM-Renderer gesperrt. */
  istKottke?: (ws: string, deal: string) => Promise<boolean>;
  speichereKv?: typeof storeCommercialDocument;
}

async function abhaengigkeiten(o: KvAusVersionOptionen): Promise<Required<KvAusVersionOptionen>> {
  const speicher = async () => (await import("./kalkulation-versionen-speicher")).dbVersionsSpeicher;
  return {
    ladeVersion: o.ladeVersion ?? (async (ws, deal, v) => (await speicher()).lesen(ws, deal, v)),
    ladeVersionen: o.ladeVersionen ?? (async (ws, deal) => (await speicher()).liste(ws, deal)),
    ladeAngebotsVersionId: o.ladeAngebotsVersionId ?? (await import("./deal-documents")).angebotsVersionId,
    hatPakete: o.hatPakete ?? (await import("./rechner/pakete")).hatPaketoptionen,
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
  // Die Quotation zeigt nicht (mehr) auf diese Version.
  const ablehnen = async (): Promise<never> => {
    // Neuere gesperrte Version: auf sie verweisen, statt eine weitere Sperre nahezulegen.
    const neueste = (await d.ladeVersionen(workspaceId, dealRecordId))
      .filter((v) => v.status === "gesperrt")
      .reduce((max, v) => Math.max(max, v.version), 0);
    if (neueste > n) {
      throw new VersionsFehler("UNGUELTIG", `Version v${n} ist nicht mehr aktuell, aktuell ist v${neueste}.`);
    }
    throw new VersionsFehler("UNGUELTIG", `Das Angebot wurde nach v${n} von Hand geändert. Neue Version sperren.`);
  };
  if ((await d.ladeAngebotsVersionId(dealRecordId)) !== version.id) await ablehnen();
  // Paketoptionen nach dem Sperren: der Paketpreis ersetzt den Festpreis der Version,
  // ein so gerenderter KV käme nicht aus dieser Version (Pakete in Versionen: Plan 3).
  if (await d.hatPakete(dealRecordId)) {
    throw new VersionsFehler(
      "PAKETE",
      "Der Deal hat Paketoptionen. Den KV bitte über „Dokument erzeugen“ erstellen; Pakete in Kalkulationsversionen kommen mit der Kalkulationsseite.",
    );
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
    // Bis zum Rendern kann eine andere Version gesperrt oder der Preis von Hand
    // geändert worden sein: gespeichert wird nur, was aus genau dieser Version kommt.
    pruefeVersion: async (gerendert) => {
      if (gerendert !== version.id) await ablehnen();
    },
  });
  return { renderer: "crm", document: gespeichert.document, fileName: gespeichert.fileName };
}

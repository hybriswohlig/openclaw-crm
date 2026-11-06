/**
 * Lädt alles, was die Kalkulationsseite zu einer Version braucht, und baut daraus
 * das Ansichtsmodell (`ansichtAus`, rein, in `lib/kalkulations-ansicht.ts`).
 * Liest nur; gerechnet wird nichts (die Frische prüft `entwurfVeraltet` ohne Rechner).
 *
 * Abhängigkeiten sind über `AnsichtOptionen` austauschbar; die Vorgaben laden
 * DB-Lader erst beim Aufruf (Tests berühren `@/db` nie). Die Route prüft vorher
 * `dealImWorkspace`; jede Abfrage hier filtert trotzdem auf Workspace (und Deal).
 */
import { ortAus, streckeAus } from "@/lib/akte";
import {
  ansichtAus,
  type InboxAnhangZeile,
  type InventarZeile,
  type KalkulationsAnsicht,
} from "@/lib/kalkulations-ansicht";
import type { ZeitpostenVorlage } from "@/lib/zeitposten";
import type { Auftragsart } from "@/lib/auftragsart";
import { entwurfVeraltet, VersionsFehler, type VersionsSpeicher } from "./kalkulation-versionen";
import { rechnerAnfrageAus, type LeadDaten } from "./rechner/eingabe";
import type { HebelArt } from "./rechner/kv-posten";
import { heuteBerlin } from "./rechner/quelle";

export interface AnsichtOptionen {
  speicher?: Pick<VersionsSpeicher, "lesen" | "liste">;
  ladeLead?: (ws: string, deal: string) => Promise<LeadDaten | null>;
  hatPakete?: (deal: string) => Promise<boolean>;
  ladePaketHebel?: (ws: string, deal: string) => Promise<Record<string, HebelArt[]> | null>;
  ladeInventar?: (ws: string, deal: string) => Promise<InventarZeile[]>;
  ladeFotos?: (ws: string, deal: string) => Promise<InboxAnhangZeile[]>;
  /** Name des Deals und seine Betriebsfirma */
  ladeKopf?: (ws: string, deal: string) => Promise<{ name: string | null; firmaId: string | null }>;
  ladeVorlagen?: (ws: string, firmaId: string) => Promise<ZeitpostenVorlage[]>;
  ladeAngebot?: (deal: string) => Promise<{ notes: string | null; isVariable: boolean; validUntil: string | null } | null>;
  /** Neuester KV (deal_documents, quotation) aus genau dieser Version */
  ladeKvDokument?: (ws: string, deal: string, versionId: string) => Promise<{ id: string; fileName: string } | null>;
  /** userId → Name */
  ladeNamen?: (ids: string[]) => Promise<Record<string, string>>;
  /** Paket-Slug → Anzeigename (Pakete der Firma des Deals) */
  ladePaketNamen?: (ws: string, deal: string) => Promise<Record<string, string>>;
  istKottke?: (ws: string, deal: string) => Promise<boolean>;
  jetzt?: () => Date;
}

const ART_WORT: Record<Auftragsart, string> = {
  umzug: "Umzug",
  entruempelung: "Entrümpelung",
  transport: "Transport",
  kuechenmontage: "Küchenmontage",
};

async function abhaengigkeiten(o: AnsichtOptionen): Promise<Required<AnsichtOptionen>> {
  const db = async () => import("./kalkulations-ansicht-db");
  return {
    speicher: o.speicher ?? (await import("./kalkulation-versionen-speicher")).dbVersionsSpeicher,
    ladeLead: o.ladeLead ?? (await import("./rechner/lead-daten")).ladeLeadDaten,
    hatPakete: o.hatPakete ?? (await import("./rechner/pakete")).hatPaketoptionen,
    ladePaketHebel: o.ladePaketHebel ?? (await import("./kalkulation-versionen-speicher")).ladePaketHebel,
    ladeInventar: o.ladeInventar ?? (await import("./deal-inventory")).getDealInventory,
    ladeFotos:
      o.ladeFotos ??
      (async (ws, deal) => (await import("./inbox")).getAttachmentsForDeal(deal, ws)),
    ladeKopf: o.ladeKopf ?? (await db()).ladeDealKopf,
    ladeVorlagen:
      o.ladeVorlagen ??
      (async (ws, firma) => (await (await import("./company-settings")).ladeFirmenEinstellungen(ws, firma)).zeitposten),
    ladeAngebot:
      o.ladeAngebot ??
      (async (deal) => {
        const q = await (await import("./quotations")).getQuotation(deal);
        return q ? { notes: q.notes ?? null, isVariable: q.isVariable === true, validUntil: q.validUntil ?? null } : null;
      }),
    ladeKvDokument: o.ladeKvDokument ?? (await db()).ladeKvDokument,
    ladeNamen: o.ladeNamen ?? (await db()).ladeNutzerNamen,
    ladePaketNamen: o.ladePaketNamen ?? (await db()).ladePaketNamen,
    istKottke: o.istKottke ?? (await import("@/lib/kottke-crm-renderer-deal")).dealBlocksInRepoCrmRenderer,
    jetzt: o.jetzt ?? (() => new Date()),
  };
}

/** Ansichtsmodell der Version `version` des Deals. Wirft `VersionsFehler("NICHT_GEFUNDEN")`. */
export async function ladeKalkulationsAnsicht(
  ws: string,
  deal: string,
  version: number,
  opts: AnsichtOptionen = {}
): Promise<KalkulationsAnsicht> {
  const d = await abhaengigkeiten(opts);
  const [v, alle, lead, hatPakete] = await Promise.all([
    d.speicher.lesen(ws, deal, version),
    d.speicher.liste(ws, deal),
    d.ladeLead(ws, deal),
    d.hatPakete(deal),
  ]);
  if (!v) throw new VersionsFehler("NICHT_GEFUNDEN", `Version v${version} nicht gefunden.`);
  if (!lead) throw new VersionsFehler("NICHT_GEFUNDEN", "Deal nicht gefunden.");

  const jetzt = d.jetzt();
  const nutzer = new Set<string>();
  for (const u of v.overrides ?? []) if (u.autor.userId) nutzer.add(u.autor.userId);
  if (v.lockedBy) nutzer.add(v.lockedBy);
  if (v.createdBy) nutzer.add(v.createdBy);

  const [paketHebel, inventar, fotos, kopf, angebot, kvDokument, namen, paketNamen, kottke] = await Promise.all([
    hatPakete ? d.ladePaketHebel(ws, deal) : Promise.resolve(null),
    d.ladeInventar(ws, deal),
    d.ladeFotos(ws, deal),
    d.ladeKopf(ws, deal),
    d.ladeAngebot(deal),
    v.status === "gesperrt" ? d.ladeKvDokument(ws, deal, v.id) : Promise.resolve(null),
    nutzer.size > 0 ? d.ladeNamen([...nutzer]) : Promise.resolve({}),
    hatPakete ? d.ladePaketNamen(ws, deal) : Promise.resolve({}),
    d.istKottke(ws, deal),
  ]);
  const vorlagen = kopf.firmaId ? await d.ladeVorlagen(ws, kopf.firmaId) : [];

  return ansichtAus(v, {
    alle: alle.map((x) => ({ version: x.version, status: x.status, priceCents: x.priceCents, sentAt: x.sentAt })),
    namen,
    deal: {
      name: kopf.name?.trim() || "Ohne Namen",
      art: lead.auftragsart ? ART_WORT[lead.auftragsart] : "",
      strecke: streckeAus(ortAus(lead.von), ortAus(lead.nach)),
      termin: lead.umzugsdatum,
      aktenLink: `/app/leads/${deal}`,
    },
    inventar,
    fotos,
    vorlagen,
    angebot,
    veraltet: entwurfVeraltet(v, rechnerAnfrageAus(lead), heuteBerlin(jetzt), paketHebel),
    kvDokument,
    jetzt,
    hatPakete,
    paketNamen,
    renderer: kottke ? "vps" : "crm",
  });
}

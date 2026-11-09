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
import type { KvErzeugung, RenderJob } from "@/lib/angebot-wahl";
import {
  ansichtAus,
  zeitpunktText,
  type InboxAnhangZeile,
  type InventarZeile,
  type KalkulationsAnsicht,
} from "@/lib/kalkulations-ansicht";
import type { ZeitpostenVorlage } from "@/lib/zeitposten";
import type { Auftragsart } from "@/lib/auftragsart";
import type { Plan5Schalter } from "@/lib/angebot-wahl";
import { entwurfVeraltet, rechenHebel, VersionsFehler, type PaketOption, type VersionsSpeicher } from "./kalkulation-versionen";
import { rechnerAnfrageAus, type LeadDaten } from "./rechner/eingabe";
import { istAdresseGenau } from "@/lib/adresse-regel";
import type { AdressInfo } from "@/lib/kalkulation-annahmen";
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
  ladeAngebot?: (
    deal: string
  ) => Promise<{ notes: string | null; isVariable: boolean; validUntil: string | null; depositRequiredCents?: number | null } | null>;
  /** Neuester KV (deal_documents, quotation) aus genau dieser Version */
  ladeKvDokument?: (ws: string, deal: string, versionId: string) => Promise<{ id: string; fileName: string } | null>;
  /** userId → Name */
  ladeNamen?: (ids: string[]) => Promise<Record<string, string>>;
  /** Paket-Slug → Anzeigename (Pakete der Firma des Deals) */
  ladePaketNamen?: (ws: string, deal: string) => Promise<Record<string, string>>;
  istKottke?: (ws: string, deal: string) => Promise<boolean>;
  /** Plan 5b: Firmen-Schalter des Deals */
  ladeSchalter?: (ws: string, deal: string) => Promise<Plan5Schalter>;
  /** Plan 12b: Buchung im Preis (für „veraltet“: eine geänderte Buchung macht den Entwurf veraltet). */
  ladeEinsatz?: (ws: string, deal: string) => Promise<import("./einsatz-preis").EinsatzPreisKontext | null>;
  /** Plan 5b: Paketoptionen des Deals */
  ladePaketOptionen?: (deal: string) => Promise<PaketOption[]>;
  /** Plan 5a: letzter KV-Job (VPS) dieser Version aus `document_render_jobs` */
  ladeKvJob?: (ws: string, deal: string, versionId: string) => Promise<RenderJob | null>;
  jetzt?: () => Date;
  /** Plan 15: letzte von der Kalkulation ins Lead geschriebene Adresse je Seite */
  ladeAdressGesetzt?: (ws: string, deal: string) => Promise<Partial<Record<"beladen" | "entladen", { adresse: string; userId: string | null; am: string }>>>;
  /** Plan 15 (Bauteil 15): Schalter „Pakete anbieten“ */
  ladePaketSchalter?: (ws: string, deal: string) => Promise<import("./plan5-schalter").PaketSchalter | null>;
  /** Plan 15: letzte Korrektur je Inventarzeile */
  ladeInventarKorrekturen?: (ws: string, deal: string) => Promise<Record<string, { userId: string | null; am: string }>>;
}

/**
 * Verständlicher Text zu einem fehlgeschlagenen KV-Job. Die Meldung im Job ist
 * technisch (VPS-Status, Ablauf nach 24 h); hier steht, was passiert ist und
 * was zu tun ist.
 */
export function kvFehlerText(fehler: string | null): string {
  const f = (fehler ?? "").toLowerCase();
  const was = /24|abgelaufen|ablauf|zeit|timeout/.test(f)
    ? "Der KV kam nicht innerhalb von 24 Stunden vom Dokumenten-Server zurück."
    : /404|nicht gefunden|unbekannt/.test(f)
      ? "Der Dokumenten-Server kennt den Auftrag nicht mehr."
      : "Der KV konnte nicht erzeugt werden.";
  return `${was} Bitte den KV neu erstellen.`;
}

/**
 * Zustand des KV auf der Kalkulationsseite (Entscheidung 5a-8). Nur eine
 * gesperrte Version mit VPS-Renderer (Kottke) hat einen Job; das CRM rendert
 * sofort, dort bleibt es bei „keins“. „fertig“ nur, wenn das abgelegte
 * Dokument der Version noch da ist.
 */
export function kvErzeugungAus(e: {
  renderer: "crm" | "vps";
  gesperrt: boolean;
  job: Pick<RenderJob, "status" | "createdAt" | "fehler"> | null;
  kvDokument: { id: string; fileName: string } | null;
}): KvErzeugung {
  if (e.renderer !== "vps" || !e.gesperrt || e.job === null) return { art: "keins" };
  switch (e.job.status) {
    case "laeuft":
      return { art: "laeuft", seit: e.job.createdAt };
    case "abgelegt":
      return e.kvDokument ? { art: "fertig", dealDocumentId: e.kvDokument.id, fileName: e.kvDokument.fileName } : { art: "keins" };
    case "verworfen":
      return { art: "verworfen" };
    case "fehler":
      return { art: "fehler", text: kvFehlerText(e.job.fehler) };
  }
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
        return q
          ? {
              notes: q.notes ?? null,
              isVariable: q.isVariable === true,
              validUntil: q.validUntil ?? null,
              depositRequiredCents: q.depositRequiredCents ?? null,
            }
          : null;
      }),
    ladeKvDokument: o.ladeKvDokument ?? (await db()).ladeKvDokument,
    ladeNamen: o.ladeNamen ?? (await db()).ladeNutzerNamen,
    ladePaketNamen: o.ladePaketNamen ?? (await db()).ladePaketNamen,
    istKottke: o.istKottke ?? (await import("@/lib/kottke-crm-renderer-deal")).dealBlocksInRepoCrmRenderer,
    ladeKvJob: o.ladeKvJob ?? (await import("./render-jobs")).letzterKvJob,
    ladeSchalter: o.ladeSchalter ?? (async (ws, deal) => (await import("./plan5-schalter")).plan5Schalter(ws, deal)),
    // Wie in kalkulation-versionen.ts: mit eigener Schalter-Vorgabe ohne Buchung im Preis.
    ladeEinsatz:
      o.ladeEinsatz ??
      (o.ladeSchalter
        ? async () => null
        : async (ws, deal) => (await import("./einsatz-preis")).einsatzPreisKontext(ws, deal, (await import("./plan5-schalter")).einsatzSchalter ?? null)),
    ladePaketOptionen:
      o.ladePaketOptionen ?? (async (deal) => (await import("./kalkulation-versionen-speicher")).ladePaketOptionen(deal)),
    jetzt: o.jetzt ?? (() => new Date()),
    ladeAdressGesetzt: o.ladeAdressGesetzt ?? (o.speicher ? async () => ({}) : (await db()).ladeAdressGesetzt),
    ladeInventarKorrekturen: o.ladeInventarKorrekturen ?? (o.speicher ? async () => ({}) : (await db()).ladeInventarKorrekturen),
    ladePaketSchalter:
      o.ladePaketSchalter ?? (o.ladeSchalter ? async () => null : async (ws, deal) => (await import("./plan5-schalter")).paketSchalter(ws, deal)),
  };
}

/** Plan 15 (Bauteile 2, 8, 10): woher die Adresse je Seite kommt. */
export function adressInfos(
  v: { status: "entwurf" | "gesperrt"; rechnerRequest: Record<string, unknown> | null },
  lead: Pick<LeadDaten, "von" | "nach" | "chatAdressen">,
  gesetzt: Partial<Record<"beladen" | "entladen", { adresse: string; userId: string | null; am: string }>>,
  namen: Record<string, string>
): { beladen: AdressInfo; entladen: AdressInfo } {
  const norm = (t: string | null | undefined) => (t ?? "").toLowerCase().replace(/[\s,]+/g, " ").trim();
  const seite = (s: "beladen" | "entladen"): AdressInfo => {
    const feld = s === "beladen" ? "von_adresse" : "nach_adresse";
    const anfrage = typeof v.rechnerRequest?.[feld] === "string" ? (v.rechnerRequest[feld] as string) : null;
    const imLead = s === "beladen" ? lead.von : lead.nach;
    const chat = s === "beladen" ? lead.chatAdressen?.von : lead.chatAdressen?.nach;
    const chatQuelle = s === "beladen" ? lead.chatAdressen?.quelleVon : lead.chatAdressen?.quelleNach;
    // Gesperrt: die eingefrorene Anfrage zählt; Chat nur, wenn sie genau die Chat-Angabe trägt.
    const text = v.status === "gesperrt" ? anfrage : imLead ?? chat ?? null;
    const quelle: AdressInfo["quelle"] = !text ? "fehlt" : (v.status === "gesperrt" ? !!chat && norm(chat) === norm(anfrage) : !imLead && !!chat) ? "chat" : "lead";
    const g = gesetzt[s];
    return {
      text,
      quelle,
      chatQuelle: quelle === "chat" ? chatQuelle ?? null : null,
      genau: !!text && istAdresseGenau(text),
      gesetzt:
        quelle === "lead" && g && imLead && norm(g.adresse) === norm(imLead)
          ? { von: (g.userId && namen[g.userId]?.split(" ")[0]) || "Kalkulation", am: g.am }
          : null,
    };
  };
  return { beladen: seite("beladen"), entladen: seite("entladen") };
}

/** Ansichtsmodell der Version `version` des Deals. Wirft `VersionsFehler("NICHT_GEFUNDEN")`. */
export async function ladeKalkulationsAnsicht(
  ws: string,
  deal: string,
  version: number,
  opts: AnsichtOptionen = {}
): Promise<KalkulationsAnsicht> {
  const d = await abhaengigkeiten(opts);
  const [v, alle, lead, schalter, einsatz, gesetzt] = await Promise.all([
    d.speicher.lesen(ws, deal, version),
    d.speicher.liste(ws, deal),
    d.ladeLead(ws, deal),
    d.ladeSchalter(ws, deal),
    d.ladeEinsatz(ws, deal),
    d.ladeAdressGesetzt(ws, deal).catch(() => ({})),
  ]);
  const paketSchalter = await d.ladePaketSchalter(ws, deal).catch(() => null);
  const inventarKorrekturen: Record<string, { userId: string | null; am: string }> = await d
    .ladeInventarKorrekturen(ws, deal)
    .catch(() => ({}));
  // Mit Schalter zählen die Paketoptionen selbst (Slug, Empfehlung); ohne wie vorher.
  const paketOptionen = schalter.angebotAusKalkulation ? await d.ladePaketOptionen(deal) : [];
  const hatPakete = schalter.angebotAusKalkulation ? paketOptionen.length > 0 : await d.hatPakete(deal);
  if (!v) throw new VersionsFehler("NICHT_GEFUNDEN", `Version v${version} nicht gefunden.`);
  if (!lead) throw new VersionsFehler("NICHT_GEFUNDEN", "Deal nicht gefunden.");

  const jetzt = d.jetzt();
  const nutzer = new Set<string>();
  for (const u of v.overrides ?? []) if (u.autor.userId) nutzer.add(u.autor.userId);
  for (const g of Object.values(gesetzt)) if (g?.userId) nutzer.add(g.userId);
  for (const k of Object.values(inventarKorrekturen)) if (k.userId) nutzer.add(k.userId);
  if (v.lockedBy) nutzer.add(v.lockedBy);
  if (v.createdBy) nutzer.add(v.createdBy);

  const [paketHebel, inventar, fotos, kopf, angebot, kvDokument, namen, paketNamen, kottke] = await Promise.all([
    hatPakete ? d.ladePaketHebel(ws, deal) : Promise.resolve(null),
    d.ladeInventar(ws, deal),
    d.ladeFotos(ws, deal),
    d.ladeKopf(ws, deal),
    d.ladeAngebot(deal),
    v.status === "gesperrt" ? d.ladeKvDokument(ws, deal, v.id) : Promise.resolve(null),
    nutzer.size > 0 ? d.ladeNamen([...nutzer]) : Promise.resolve({} as Record<string, string>),
    hatPakete ? d.ladePaketNamen(ws, deal) : Promise.resolve({}),
    d.istKottke(ws, deal),
  ]);
  const gesperrt = v.status === "gesperrt";
  const [vorlagen, kvJob] = await Promise.all([
    kopf.firmaId ? d.ladeVorlagen(ws, kopf.firmaId) : Promise.resolve([]),
    // Nur ein Anzeigezustand: fällt das Job-Register aus, lädt die Seite trotzdem (dann „keins“).
    kottke && gesperrt
      ? d.ladeKvJob(ws, deal, v.id).catch((err: unknown) => {
          console.error("[kalkulations-ansicht] letzterKvJob", err);
          return null;
        })
      : Promise.resolve(null),
  ]);

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
    veraltet: entwurfVeraltet(
      v,
      rechnerAnfrageAus(lead),
      heuteBerlin(jetzt),
      rechenHebel(schalter, hatPakete, paketOptionen, paketHebel) ?? null,
      schalter,
      einsatz
    ),
    kvDokument,
    jetzt,
    hatPakete,
    paketNamen,
    renderer: kottke ? "vps" : "crm",
    kvErzeugung: kvErzeugungAus({ renderer: kottke ? "vps" : "crm", gesperrt, job: kvJob, kvDokument }),
    schalter,
    paketOptionen: paketOptionen.map((o) => ({ catalogueSlug: o.catalogueSlug, isRecommended: o.isRecommended })),
    paketHebel: paketHebel ?? {},
    adressen: adressInfos(v, lead, gesetzt, namen),
    ...(paketSchalter ? { paketSchalter } : {}),
    inventarKorrekturen: Object.fromEntries(
      Object.entries(inventarKorrekturen).map(([id, k]) => [
        id,
        { von: (k.userId && namen[k.userId]?.split(" ")[0]) || "von Hand", am: zeitpunktText(k.am) },
      ])
    ),
  });
}

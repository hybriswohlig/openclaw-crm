/**
 * Lagekarte: setzt die Antwort von GET /api/v1/lagekarte und der lesenden
 * Chat-Vorschau aus den Bulk-Queries (laden.ts) und den reinen Regeln
 * zusammen. Keine Schreibzugriffe, keine Seiteneffekte.
 */
import { brandingForOperatingCompany } from "@openclaw-crm/customer-portal-core";
import type {
  ChatKurz,
  ChatNachricht,
  ChatVorschauAntwort,
  Firma,
  LagekarteAntwort,
  LeadPunkt,
} from "@/lib/lagekarte/typen";
import { loeseOrte, type AdressRoh, type ImmoscoutRoh } from "./geo";
import { berechneKennzahlen } from "./kennzahlen";
import { kvDokument } from "./kv";
import {
  CHAT_LIMIT,
  ladeChatRoh,
  ladeLagekarteRoh,
  type DealAttribut,
  type FirmaRoh,
  type LagekarteRoh,
  type ThreadAggregatRoh,
  type ThreadRoh,
  type WertRoh,
} from "./laden";
import { erzeugeMissionen } from "./missionen";
import { kartenStatus } from "./status";
import { wartetAuf, type ThreadSignal } from "./wartet";
import { bezahltCent, leadWert, type AngebotRoh } from "./wert";

const VORSCHAU_MAX = 140;
const NACHRICHT_MAX = 2000;

export async function ladeLagekarte(workspaceId: string, jetzt: Date = new Date()): Promise<LagekarteAntwort> {
  return baueLagekarte(await ladeLagekarteRoh(workspaceId), jetzt);
}

export async function ladeChatVorschau(
  workspaceId: string,
  conversationId: string,
): Promise<ChatVorschauAntwort | null> {
  const roh = await ladeChatRoh(workspaceId, conversationId);
  if (!roh) return null;

  const zeitVon = (m: { sentAt: Date | null; createdAt: Date }) => m.sentAt ?? m.createdAt;
  const neueste = roh.nachrichten[0] ?? null;
  const nachrichten: ChatNachricht[] = roh.nachrichten
    .slice(0, CHAT_LIMIT)
    .reverse()
    .map((m) => ({
      id: m.id,
      richtung: m.direction,
      text: kuerze(nachrichtText(m.body, m.subject), NACHRICHT_MAX),
      zeit: zeitVon(m).toISOString(),
      status: m.status,
    }));

  const t = roh.thread;
  const chat: ChatKurz = {
    id: t.id,
    kanal: t.kanal,
    kontoName: t.kontoName,
    firmaId: t.kontoFirmaId,
    status: t.status,
    letzteNachrichtAm: iso(neueste ? zeitVon(neueste) : t.lastMessageAt),
    vorschau: t.lastMessagePreview === null ? null : kuerze(t.lastMessagePreview, VORSCHAU_MAX),
    ungelesen: t.unreadCount,
    kundeZuletzt: neueste?.direction === "inbound",
  };

  return { chat, nachrichten, mehr: roh.nachrichten.length > CHAT_LIMIT };
}

// ─── Zusammenbau ────────────────────────────────────────────────────────────

function baueLagekarte(roh: LagekarteRoh, jetzt: Date): LagekarteAntwort {
  const firmen = baueFirmen(roh.firmen);
  const bekannteFirmen = new Set(firmen.map((f) => f.id));
  const stufeNachId = new Map(roh.stufen.map((s) => [s.id, s]));

  const werte = werteJeDeal(roh.werte);
  const nummern = new Map(roh.nummern.map((n) => [n.dealRecordId, n.dealNumber]));
  const annahmen = new Map(roh.annahmen.map((a) => [a.dealRecordId, a]));
  const angebote = new Map(roh.angebote.map((q) => [q.dealRecordId, q]));
  const positionen = gruppiere(roh.positionen, (p) => p.quotationId);
  const optionen = gruppiere(roh.optionen, (o) => o.dealRecordId);
  const dokumente = gruppiere(roh.dokumente, (d) => d.dealRecordId);
  const links = new Map(roh.links.map((l) => [l.dealRecordId, l]));
  const zahlungen = gruppiere(roh.zahlungen, (z) => z.dealRecordId ?? "");
  const rechner = new Map(roh.rechner.map((r) => [r.dealRecordId, r.result]));
  const threads = gruppiere(roh.threads, (t) => t.dealRecordId);
  const aggregate = new Map(roh.aggregate.map((a) => [a.conversationId, a]));
  const entwurfDeals = new Set(roh.entwurfDeals.map((e) => e.dealRecordId));

  const leads: LeadPunkt[] = roh.deals.map((deal) => {
    const w = werte.get(deal.id);
    const stufeId = w?.get("stage")?.textValue ?? null;
    const stufe = stufeId ? (stufeNachId.get(stufeId) ?? null) : null;
    const annahme = annahmen.get(deal.id) ?? null;
    const angebot = angebote.get(deal.id) ?? null;
    const link = links.get(deal.id) ?? null;

    const { status, hinweis, zahlungOffen } = kartenStatus({
      stufe: stufe ? { titel: stufe.titel, kategorie: stufe.kategorie } : null,
      kvaAktiv: annahme !== null,
      angebotErstellt: angebot !== null,
    });

    const payload = alsObjekt(w?.get("moving_lead_payload")?.jsonValue);
    const { ort, ziel } = loeseOrte({
      leadId: deal.id,
      abholung: alsAdresse(w?.get("move_from_address")?.jsonValue),
      immoscoutVon: alsImmoscout(payload?.from),
      ziel: alsAdresse(w?.get("move_to_address")?.jsonValue),
      immoscoutNach: alsImmoscout(payload?.to),
    });

    const angebotRoh: AngebotRoh | null = angebot
      ? {
          fixedPriceEuro: angebot.fixedPrice,
          isVariable: angebot.isVariable,
          selectedPackageOptionId: angebot.selectedPackageOptionId,
          optionen: optionen.get(deal.id) ?? [],
          positionen: (positionen.get(angebot.id) ?? []).map((p) => ({
            quantity: p.quantity,
            unitRateEuro: p.unitRate,
          })),
        }
      : null;

    const dokument = kvDokument({
      angenommenDokumentId: annahme?.quotationDocumentId ?? null,
      angenommen: annahme !== null,
      quotationUpdatedAt: angebot?.updatedAt ?? null,
      docs: dokumente.get(deal.id) ?? [],
    });

    const dealThreads = threads.get(deal.id) ?? [];
    const signale = dealThreads.map((t) => threadSignal(t, aggregate.get(t.id)));
    const { wartet, veraltet, emailUngelesen } = wartetAuf({
      status,
      angelegtAm: deal.createdAt,
      threads: signale,
      jetzt,
    });
    const chats = dealThreads.map((t) => chatKurz(t, aggregate.get(t.id)));

    const firmaId = w?.get("operating_company")?.referencedRecordId ?? null;

    return {
      id: deal.id,
      nummer: nummern.get(deal.id) ?? null,
      name: w?.get("name")?.textValue?.trim() || "Unbenannt",
      angelegtAm: deal.createdAt.toISOString(),
      umzugAm: w?.get("move_date")?.dateValue ?? null,
      firmaId: firmaId && bekannteFirmen.has(firmaId) ? firmaId : null,
      stufe: stufe ? { id: stufe.id, titel: stufe.titel, farbe: stufe.farbe } : null,
      status,
      statusHinweis: hinweis,
      zahlungOffen,
      ort,
      ziel,
      wert: leadWert({
        kvaCent: annahme?.confirmedTotalCents ?? null,
        angebot: angebotRoh,
        dealValue: w?.get("value")?.jsonValue ?? null,
        rechnerErgebnis: rechner.get(deal.id) ?? null,
      }),
      bezahltCent: bezahltCent(
        (zahlungen.get(deal.id) ?? []).map((z) => ({ amountEuro: z.amount, taxTreatment: z.taxTreatment })),
      ),
      wartet,
      veraltet,
      emailUngelesen,
      chats: sortiereChats(chats),
      kv: {
        angebotErstellt: angebot !== null,
        angebotErstelltAm: iso(angebot?.createdAt ?? null),
        linkAktiv: link !== null && link.revokedAt === null,
        linkErstelltAm: iso(link?.createdAt ?? null),
        linkAngesehenAnzahl: link?.viewCount ?? 0,
        linkZuletztAngesehen: iso(link?.lastViewedAt ?? null),
        angenommenAm: iso(annahme?.signedAt ?? null),
        dokumentId: dokument.dokumentId,
        dokumentStand: dokument.dokumentStand,
      },
      kiEntwurfWartet: entwurfDeals.has(deal.id),
      telefon: telefonDesNeuestenThreads(dealThreads, aggregate),
    };
  });

  leads.sort((a, b) => vergleiche(b.angelegtAm, a.angelegtAm) || vergleiche(a.id, b.id));

  return {
    stand: jetzt.toISOString(),
    firmen,
    stufen: roh.stufen,
    leads,
    kennzahlen: berechneKennzahlen(leads, jetzt),
    missionen: erzeugeMissionen(leads, jetzt),
  };
}

// ─── Firmen ─────────────────────────────────────────────────────────────────

function baueFirmen(zeilen: FirmaRoh[]): Firma[] {
  const eindeutig = new Map<string, FirmaRoh>();
  for (const z of zeilen) if (!eindeutig.has(z.id)) eindeutig.set(z.id, z);

  const basis = [...eindeutig.values()]
    .map((z) => {
      const name = z.name?.trim() || "Unbenannte Firma";
      return { id: z.id, name, farbe: firmenFarbe(z.primaryColor, z.name), erster: zeichenVon(name)[0] ?? "?" };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "de") || vergleiche(a.id, b.id));

  const jeErstem = new Map<string, number>();
  for (const f of basis) jeErstem.set(f.erster, (jeErstem.get(f.erster) ?? 0) + 1);

  return basis.map(({ erster, ...f }) => ({
    ...f,
    kurz: (jeErstem.get(erster) ?? 0) > 1 ? zweiBuchstaben(f.name) : erster,
  }));
}

/** Buchstaben und Ziffern eines Namens, groß, als Codepoints. */
function zeichenVon(text: string): string[] {
  return Array.from(text.toLocaleUpperCase("de-DE")).filter((c) => /[\p{L}\p{N}]/u.test(c));
}

/** Bei Kollision: Anfangsbuchstaben der ersten zwei Wörter, sonst die ersten zwei Buchstaben. */
function zweiBuchstaben(name: string): string {
  const woerter = name.split(/[\s\-–/&+]+/).map(zeichenVon).filter((w) => w.length > 0);
  if (woerter.length >= 2) return woerter[0][0] + woerter[1][0];
  return (woerter[0] ?? ["?"]).slice(0, 2).join("");
}

/** Portal-Farbe (gespeichert ohne #), sonst Stammdaten-Fallback der Firma. */
function firmenFarbe(primaryColor: string | null, name: string | null): string {
  const hex = primaryColor?.trim().replace(/^#/, "") ?? "";
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex.toLowerCase()}`;
  return `#${brandingForOperatingCompany(name).primaryColor}`;
}

// ─── Deal-Werte ─────────────────────────────────────────────────────────────

function werteJeDeal(zeilen: WertRoh[]): Map<string, Map<DealAttribut, WertRoh>> {
  const ergebnis = new Map<string, Map<DealAttribut, WertRoh>>();
  for (const z of zeilen) {
    let werte = ergebnis.get(z.recordId);
    if (!werte) ergebnis.set(z.recordId, (werte = new Map()));
    // Einzelwert-Attribute: der erste Wert (nach sort_order) gilt.
    if (!werte.has(z.slug)) werte.set(z.slug, z);
  }
  return ergebnis;
}

function alsObjekt(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function alsText(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * location-Wert: Objekt { line1, postcode | postalCode, city } oder (Altbestand)
 * ein reiner Adress-String, der dann als Freitext (line1) gilt.
 */
function alsAdresse(v: unknown): AdressRoh | null {
  if (typeof v === "string") return v.trim() ? { line1: v.trim() } : null;
  const o = alsObjekt(v);
  if (!o) return null;
  return {
    postcode: alsText(o.postcode) ?? alsText(o.postalCode),
    city: alsText(o.city),
    line1: alsText(o.line1),
  };
}

/** moving_lead_payload.from / .to (ImmoScout). Nie client.zip. */
function alsImmoscout(v: unknown): ImmoscoutRoh | null {
  const o = alsObjekt(v);
  if (!o) return null;
  return { zip: alsText(o.zip), city: alsText(o.city), street: alsText(o.street) };
}

// ─── Threads ────────────────────────────────────────────────────────────────

function threadSignal(t: ThreadRoh, a: ThreadAggregatRoh | undefined): ThreadSignal {
  return {
    id: t.id,
    kanal: t.kanal,
    status: t.status,
    lane: t.lane,
    letzteEingehend: a?.letzteEingehend ?? null,
    letzteAusgehend: a?.letzteAusgehend ?? null,
    ersteEingehendNachAusgehend: a?.ersteEingehendNachAusgehend ?? null,
    ungelesen: t.unreadCount,
  };
}

/** Letzte Aktivität laut Nachrichten (coalesce(sent_at, created_at)), sonst last_message_at. */
function letzteNachricht(t: ThreadRoh, a: ThreadAggregatRoh | undefined): Date | null {
  const ein = a?.letzteEingehend ?? null;
  const aus = a?.letzteAusgehend ?? null;
  if (ein && aus) return ein.getTime() >= aus.getTime() ? ein : aus;
  return ein ?? aus ?? t.lastMessageAt;
}

function chatKurz(t: ThreadRoh, a: ThreadAggregatRoh | undefined): ChatKurz {
  const ein = a?.letzteEingehend ?? null;
  const aus = a?.letzteAusgehend ?? null;
  return {
    id: t.id,
    kanal: t.kanal,
    kontoName: t.kontoName,
    firmaId: t.kontoFirmaId,
    status: t.status,
    letzteNachrichtAm: iso(letzteNachricht(t, a)),
    vorschau: t.lastMessagePreview === null ? null : kuerze(t.lastMessagePreview, VORSCHAU_MAX),
    ungelesen: t.unreadCount,
    kundeZuletzt: ein !== null && (aus === null || ein.getTime() > aus.getTime()),
  };
}

/** Offene vor erledigten (resolved/spam), dann neueste Nachricht zuerst, ohne Zeit zuletzt. */
function sortiereChats(chats: ChatKurz[]): ChatKurz[] {
  const rang = (c: ChatKurz) => (c.status === "open" ? 0 : 1);
  return [...chats].sort(
    (a, b) =>
      rang(a) - rang(b) ||
      vergleiche(b.letzteNachrichtAm ?? "", a.letzteNachrichtAm ?? "") ||
      vergleiche(a.id, b.id),
  );
}

/** Telefon des Threads mit der jüngsten Aktivität, der überhaupt eine Nummer hat. */
function telefonDesNeuestenThreads(
  threads: ThreadRoh[],
  aggregate: Map<string, ThreadAggregatRoh>,
): string | null {
  let bester: { telefon: string; zeit: number } | null = null;
  for (const t of threads) {
    const telefon = t.telefon?.trim();
    if (!telefon) continue;
    const zeit = (letzteNachricht(t, aggregate.get(t.id)) ?? t.createdAt).getTime();
    if (!bester || zeit > bester.zeit) bester = { telefon, zeit };
  }
  return bester?.telefon ?? null;
}

// ─── Kleinkram ──────────────────────────────────────────────────────────────

function nachrichtText(body: string, subject: string | null): string {
  if (body.trim()) return body;
  if (subject?.trim()) return subject;
  return "(ohne Text)";
}

/** Kürzt auf höchstens max Zeichen (Codepoints, Emojis bleiben ganz), mit „…“ am Ende. */
function kuerze(text: string, max: number): string {
  const zeichen = Array.from(text);
  return zeichen.length <= max ? text : `${zeichen.slice(0, max - 1).join("")}…`;
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function vergleiche(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function gruppiere<T>(zeilen: T[], schluessel: (z: T) => string): Map<string, T[]> {
  const ergebnis = new Map<string, T[]>();
  for (const z of zeilen) {
    const k = schluessel(z);
    const liste = ergebnis.get(k);
    if (liste) liste.push(z);
    else ergebnis.set(k, [z]);
  }
  return ergebnis;
}

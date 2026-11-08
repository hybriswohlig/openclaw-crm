/**
 * Kundenliste und Kundenakte aus Pivot-Zeilen (Plan 11, Task E). Rein, ohne
 * Datenbank. Der offene Rest je Deal kommt aus `offenAus`.
 *
 * `KundenUmzug.bewertung` bleibt null: die Lage brauchte Token, Vormerkung,
 * Status und Google-Link je Deal, und die Akte zeigt den Stand dort nicht.
 */
import { canonicalizePhone } from "@/lib/identity/canonical";
import { normalizeKontaktart, type Kontaktart } from "@/lib/kontaktart";
import { nameAusWert } from "@/lib/personen-name";
import type { StageCategory } from "@/lib/wartet";
import { alsIso, alsJson, alsTag } from "@/lib/db-werte";
import { offenAus, type OffenEingabe } from "@/lib/geld";
import {
  KUNDEN_STUFEN,
  dublettenSchluessel,
  gespraecheJeFirma,
  istWiederkehrer,
  kundenArt,
  markeAusFirmenname,
  offenSumme,
  type DealOhneKunde,
  type FirmaKurz,
  type KundenAkte,
  type KundenAnsicht,
  type KundenGespraech,
  type KundenSuche,
  type KundenUmzug,
  type KundenZeile,
} from "@/lib/bewertungen-kunden";

const STUFEN = new Set<string>([
  "open_new",
  "open_engaged",
  "quoted",
  "booked",
  "done_unpaid",
  "paid",
  "lost",
  "kein_lead",
]);

const OHNE_GELD: OffenEingabe = {
  rechnung: null,
  annahmeCent: null,
  festpreis: null,
  istStunden: false,
  zahlungen: [],
};

export interface KundenDealRoh {
  dealId: string;
  dealNummer: string | null;
  titel: string;
  erstelltAm: string;
  kategorie: StageCategory | null;
  label: string;
  umzugsdatum: string | null;
  firma: FirmaKurz | null;
  aktiveAnnahme: boolean;
  nichtKontaktieren: boolean;
}

export interface KundenPersonRoh {
  personId: string;
  /** Anzeigename (`nameAusWert`). */
  name: string;
  /** Text und `full_name`, darüber läuft die Namenssuche. */
  suchnamen: string[];
  kontaktart: Kontaktart | null;
  telefone: string[];
  emails: string[];
  telefoneKanonisch: string[];
  emailsKanonisch: string[];
  deals: KundenDealRoh[];
}

export interface DealOhneRoh {
  dealId: string;
  dealNummer: string | null;
  titel: string;
  stufe: { label: string; kategorie: StageCategory | null };
  firma: FirmaKurz | null;
  angelegtAm: string;
}

/** Zeile der Personen-Abfrage, wie `db.execute` sie liefert. */
export interface PersonZeile {
  person_id: string;
  name_text?: string | null;
  name_json?: unknown;
  kontaktart?: string | null;
  telefone?: unknown;
  emails?: unknown;
  kennungen?: unknown;
  deals?: unknown;
}

export interface DealOhneZeile {
  deal_id: string;
  angelegt_am?: unknown;
  nummer?: string | null;
  titel?: string | null;
  stufe_label?: string | null;
  stufe_kategorie?: string | null;
  firma_id?: string | null;
  firma_name?: string | null;
}

function kategorieAus(v: unknown): StageCategory | null {
  return typeof v === "string" && STUFEN.has(v) ? (v as StageCategory) : null;
}

function texteAus(v: unknown): string[] {
  const liste = alsJson(v);
  if (!Array.isArray(liste)) return [];
  return liste.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim());
}

function kennungenAus(v: unknown): { kind: string; wert: string }[] {
  const liste = alsJson(v);
  if (!Array.isArray(liste)) return [];
  const aus: { kind: string; wert: string }[] = [];
  for (const eintrag of liste) {
    if (!eintrag || typeof eintrag !== "object") continue;
    const o = eintrag as Record<string, unknown>;
    if (typeof o.kind !== "string" || typeof o.wert !== "string" || o.wert.trim() === "") continue;
    aus.push({ kind: o.kind, wert: o.wert.trim() });
  }
  return aus;
}

function suchnamenAus(text: string | null, json: unknown): string[] {
  const namen: string[] = [];
  const roh = text?.trim();
  if (roh) namen.push(roh);
  const j = alsJson(json);
  if (j && typeof j === "object" && !Array.isArray(j)) {
    const o = j as Record<string, unknown>;
    for (const schluessel of ["full_name", "fullName"]) {
      const wert = o[schluessel];
      if (typeof wert === "string" && wert.trim()) namen.push(wert.trim());
    }
  }
  const anzeige = nameAusWert(text, j);
  if (anzeige) namen.push(anzeige);
  return [...new Set(namen)];
}

export function firmaKurz(id: unknown, name: unknown): FirmaKurz | null {
  if (typeof id !== "string" || id === "") return null;
  const n = typeof name === "string" ? name.trim() : "";
  return { id, name: n, marke: markeAusFirmenname(n) };
}

function alsBool(v: unknown): boolean {
  return v === true || v === "true" || v === "t" || v === 1;
}

function dealAusJson(v: unknown): KundenDealRoh | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id === "") return null;
  const label = typeof o.label === "string" && o.label.trim() ? o.label.trim() : "Ohne Stufe";
  const titel = typeof o.titel === "string" && o.titel.trim() ? o.titel.trim() : "Ohne Namen";
  return {
    dealId: o.id,
    dealNummer: typeof o.nummer === "string" && o.nummer.trim() ? o.nummer.trim() : null,
    titel,
    erstelltAm: alsIso(o.erstelltAm) ?? "",
    kategorie: kategorieAus(o.kategorie),
    label,
    umzugsdatum: alsTag(typeof o.umzug === "string" ? o.umzug : null),
    firma: firmaKurz(o.firmaId, o.firmaName),
    aktiveAnnahme: alsBool(o.annahme),
    nichtKontaktieren: alsBool(o.nichtKontaktieren),
  };
}

/** Pivot-Zeile zur Personen-Eingabe. Null ohne Personen-Id. */
export function personAusZeile(z: PersonZeile): KundenPersonRoh | null {
  if (!z.person_id) return null;
  const nameJson = alsJson(z.name_json);
  const telefone = texteAus(z.telefone);
  const emails = texteAus(z.emails);
  const kennungen = kennungenAus(z.kennungen);
  const telefoneKanonisch = new Set<string>();
  for (const telefon of telefone) {
    const e164 = canonicalizePhone(telefon, "DE");
    if (e164) telefoneKanonisch.add(e164);
  }
  const emailsKanonisch = new Set<string>();
  for (const email of emails) {
    const klein = email.trim().toLowerCase();
    if (klein) emailsKanonisch.add(klein);
  }
  for (const k of kennungen) {
    if (k.kind === "phone") {
      telefoneKanonisch.add(k.wert);
      const e164 = canonicalizePhone(k.wert, "DE");
      if (e164) telefoneKanonisch.add(e164);
    }
    if (k.kind === "email") {
      const klein = k.wert.trim().toLowerCase();
      if (klein) emailsKanonisch.add(klein);
    }
  }
  const dealsJson = alsJson(z.deals);
  const deals = Array.isArray(dealsJson) ? dealsJson.flatMap((d) => {
    const deal = dealAusJson(d);
    return deal ? [deal] : [];
  }) : [];
  return {
    personId: z.person_id,
    name: nameAusWert(z.name_text ?? null, nameJson) ?? "",
    suchnamen: suchnamenAus(z.name_text ?? null, nameJson),
    kontaktart: normalizeKontaktart(z.kontaktart),
    telefone,
    emails,
    telefoneKanonisch: [...telefoneKanonisch],
    emailsKanonisch: [...emailsKanonisch],
    deals,
  };
}

export function dealOhneAusZeile(z: DealOhneZeile): DealOhneRoh | null {
  if (!z.deal_id) return null;
  const angelegt = alsIso(z.angelegt_am);
  if (!angelegt) return null;
  return {
    dealId: z.deal_id,
    dealNummer: z.nummer?.trim() ? z.nummer.trim() : null,
    titel: z.titel?.trim() ? z.titel.trim() : "Ohne Namen",
    stufe: {
      label: z.stufe_label?.trim() ? z.stufe_label.trim() : "Ohne Stufe",
      kategorie: kategorieAus(z.stufe_kategorie),
    },
    firma: firmaKurz(z.firma_id, z.firma_name),
    angelegtAm: angelegt,
  };
}

function ilikeTeil(wert: string, muster: string): boolean {
  return wert.toLocaleLowerCase("de").includes(muster.toLocaleLowerCase("de"));
}

function passtPerson(p: KundenPersonRoh, suche: KundenSuche): boolean {
  switch (suche.art) {
    case "leer":
      return true;
    case "telefon":
      return p.telefoneKanonisch.includes(suche.e164);
    case "email":
      return p.emailsKanonisch.includes(suche.text);
    case "dealnummer":
      return p.deals.some((d) => d.dealNummer === suche.nummer);
    case "name":
      return p.suchnamen.some((n) => ilikeTeil(n, suche.text));
    default:
      return false;
  }
}

function passtDeal(d: DealOhneRoh, suche: KundenSuche): boolean {
  switch (suche.art) {
    case "leer":
      return true;
    case "dealnummer":
      return d.dealNummer === suche.nummer;
    case "name":
      return ilikeTeil(d.titel, suche.text);
    default:
      return false;
  }
}

function zuletztAm(p: KundenPersonRoh): number {
  let max = Number.NEGATIVE_INFINITY;
  for (const d of p.deals) {
    const t = Date.parse(d.erstelltAm);
    if (Number.isFinite(t) && t > max) max = t;
  }
  return max;
}

function firmenAus(deals: { firma: FirmaKurz | null }[]): FirmaKurz[] {
  const map = new Map<string, FirmaKurz>();
  for (const d of deals) {
    if (d.firma && !map.has(d.firma.id)) map.set(d.firma.id, d.firma);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "de") || a.id.localeCompare(b.id));
}

function letzterUmzug(deals: KundenDealRoh[]): string | null {
  const daten = deals.map((d) => d.umzugsdatum).filter((d): d is string => !!d);
  daten.sort();
  return daten.at(-1) ?? null;
}

function seiteAb<T>(zeilen: T[], idVon: (z: T) => string, weiter: string | null, seite: number): { teil: T[]; weiter: string | null } {
  const n = Math.max(1, Math.floor(seite));
  let start = 0;
  if (weiter) {
    const i = zeilen.findIndex((z) => idVon(z) === weiter);
    start = i < 0 ? zeilen.length : i + 1;
  }
  const teil = zeilen.slice(start, start + n);
  const letzte = teil.at(-1);
  const mehr = start + teil.length < zeilen.length;
  return { teil, weiter: mehr && letzte ? idVon(letzte) : null };
}

function geldVon(geld: ReadonlyMap<string, OffenEingabe>, dealId: string): OffenEingabe {
  return geld.get(dealId) ?? OHNE_GELD;
}

function zeileAus(p: KundenPersonRoh, geld: ReadonlyMap<string, OffenEingabe>, dublette: boolean): KundenZeile {
  const reste = p.deals.map((d) => offenAus(geldVon(geld, d.dealId)).restCent);
  return {
    personId: p.personId,
    name: p.name,
    telefon: p.telefone[0] ?? null,
    firmen: firmenAus(p.deals),
    auftraege: p.deals.filter((d) => !!d.kategorie && KUNDEN_STUFEN.includes(d.kategorie)).length,
    letzterUmzug: letzterUmzug(p.deals),
    offenCent: offenSumme(reste),
    wiederkehrer: istWiederkehrer(p.deals.map((d) => d.kategorie)),
    dublette,
  };
}

export interface KundenVorbereitung {
  seite: KundenPersonRoh[];
  weiter: string | null;
  istDublette: (p: KundenPersonRoh) => boolean;
}

/**
 * Personen der Ansicht, neueste Deal-Anlage zuerst, dann `personId`.
 * `weiter` ist die Personen-Id der letzten Zeile der vorigen Seite.
 * Dublette: Vorschlag oder gleicher nicht leerer Schlüssel unter den
 * Personen dieser Ansicht nach der Suche (nicht nur der aktuellen Seite).
 */
export function kundenVorbereiten(
  personen: KundenPersonRoh[],
  vorschlag: ReadonlySet<string>,
  e: { ansicht: Exclude<KundenAnsicht, "ohne_kunde">; suche: KundenSuche; weiter: string | null; seite: number },
): KundenVorbereitung {
  const liste = personen
    .filter((p) => {
      const art = kundenArt({
        kontaktart: p.kontaktart,
        dealKategorien: p.deals.map((d) => d.kategorie),
        aktiveAnnahme: p.deals.some((d) => d.aktiveAnnahme),
      });
      return art === (e.ansicht === "kunden" ? "kunde" : "anfrage") && passtPerson(p, e.suche);
    })
    .sort((a, b) => zuletztAm(b) - zuletztAm(a) || a.personId.localeCompare(b.personId));

  const zaehler = new Map<string, number>();
  for (const p of liste) {
    const schluessel = dublettenSchluessel(p.name);
    if (!schluessel) continue;
    zaehler.set(schluessel, (zaehler.get(schluessel) ?? 0) + 1);
  }

  const seite = seiteAb(liste, (p) => p.personId, e.weiter, e.seite);
  return {
    seite: seite.teil,
    weiter: seite.weiter,
    istDublette: (p) => {
      const schluessel = dublettenSchluessel(p.name);
      const gleicherName = !!schluessel && (zaehler.get(schluessel) ?? 0) > 1;
      return vorschlag.has(p.personId) || gleicherName;
    },
  };
}

/** Personen der Ansicht zu Zeilen. Geld nur für die Deals der ausgelieferten Seite nötig. */
export function kundenZeilen(
  personen: KundenPersonRoh[],
  geld: ReadonlyMap<string, OffenEingabe>,
  vorschlag: ReadonlySet<string>,
  e: { ansicht: Exclude<KundenAnsicht, "ohne_kunde">; suche: KundenSuche; weiter: string | null; seite: number },
): { zeilen: KundenZeile[]; weiter: string | null } {
  const vor = kundenVorbereiten(personen, vorschlag, e);
  return {
    zeilen: vor.seite.map((p) => zeileAus(p, geld, vor.istDublette(p))),
    weiter: vor.weiter,
  };
}

/** Deals ohne Kunde: neueste Anlage zuerst, dann `dealId`. Telefon und E-Mail treffen hier nichts. */
export function dealsOhneKundeZeilen(
  deals: DealOhneRoh[],
  e: { suche: KundenSuche; weiter: string | null; seite: number },
): { ohneKunde: DealOhneKunde[]; weiter: string | null } {
  const liste = deals
    .filter((d) => d.stufe.kategorie !== "lost" && d.stufe.kategorie !== "kein_lead" && passtDeal(d, e.suche))
    .sort((a, b) => Date.parse(b.angelegtAm) - Date.parse(a.angelegtAm) || a.dealId.localeCompare(b.dealId));
  const seite = seiteAb(liste, (d) => d.dealId, e.weiter, e.seite);
  return {
    ohneKunde: seite.teil.map((d) => ({
      dealId: d.dealId,
      dealNummer: d.dealNummer,
      titel: d.titel,
      stufe: d.stufe,
      firma: d.firma,
      angelegtAm: d.angelegtAm,
    })),
    weiter: seite.weiter,
  };
}

function dublettenAus(
  selbst: { personId: string; name: string },
  vorschlaege: { personId: string; name: string }[],
  namenMitDeal: { personId: string; name: string }[],
): KundenAkte["dubletten"] {
  const gesehen = new Set<string>();
  const aus: KundenAkte["dubletten"] = [];
  const dazu = (personId: string, name: string, grund: "vorschlag" | "gleicher_name") => {
    if (!personId || personId === selbst.personId || gesehen.has(personId)) return;
    gesehen.add(personId);
    aus.push({ personId, name, grund });
  };
  for (const v of vorschlaege) dazu(v.personId, v.name, "vorschlag");
  const schluessel = dublettenSchluessel(selbst.name);
  if (schluessel) {
    for (const a of namenMitDeal) {
      if (dublettenSchluessel(a.name) === schluessel) dazu(a.personId, a.name, "gleicher_name");
    }
  }
  return aus;
}

function umzugAus(d: KundenDealRoh, geld: ReadonlyMap<string, OffenEingabe>): KundenUmzug {
  const offen = offenAus(geldVon(geld, d.dealId));
  return {
    dealId: d.dealId,
    dealNummer: d.dealNummer,
    titel: d.titel,
    stufe: { label: d.label, kategorie: d.kategorie },
    umzugsdatum: d.umzugsdatum,
    firma: d.firma,
    gesamtCent: offen.gesamtCent,
    offenCent: offen.restCent,
    bewertung: null,
  };
}

/** Akte einer schon gelesenen Person. Umzüge neueste Deal-Anlage zuerst. */
export function kundenAkteBauen(e: {
  person: KundenPersonRoh;
  geld: ReadonlyMap<string, OffenEingabe>;
  gespraeche: KundenGespraech[];
  vorschlaege: { personId: string; name: string }[];
  namenMitDeal: { personId: string; name: string }[];
}): KundenAkte {
  const deals = [...e.person.deals].sort(
    (a, b) => Date.parse(b.erstelltAm) - Date.parse(a.erstelltAm) || a.dealId.localeCompare(b.dealId),
  );
  const umzuege = deals.map((d) => umzugAus(d, e.geld));
  const firmen = firmenAus(deals);
  return {
    personId: e.person.personId,
    name: e.person.name,
    kontaktart: e.person.kontaktart,
    art: kundenArt({
      kontaktart: e.person.kontaktart,
      dealKategorien: deals.map((d) => d.kategorie),
      aktiveAnnahme: deals.some((d) => d.aktiveAnnahme),
    }),
    telefone: e.person.telefone,
    emails: e.person.emails,
    firmen,
    mehrfachFirma: firmen.length > 1,
    wiederkehrer: istWiederkehrer(deals.map((d) => d.kategorie)),
    bewertungGesperrt: deals.some((d) => d.nichtKontaktieren),
    umzuege,
    offenCent: offenSumme(umzuege.map((u) => u.offenCent)),
    gespraeche: gespraecheJeFirma(e.gespraeche),
    dubletten: dublettenAus(e.person, e.vorschlaege, e.namenMitDeal),
  };
}

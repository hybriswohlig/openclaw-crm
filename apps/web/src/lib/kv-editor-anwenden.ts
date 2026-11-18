/**
 * Reine Kernfunktionen des KV-Editors (Plan Aufgabe 1, Vertrag `KvEditorKern` in `lib/kv-editor.ts`).
 *
 * Katalog aus dem Paket lesen (VPS, CRM), Änderungen anwenden, Eingaben prüfen, Listen fortschreiben,
 * abgleichen und zusammenführen, Push-Regeln und Preisprüfung des VPS-PDFs. Keine Datenbank, kein Netz;
 * Eingaben werden nie verändert.
 */
import type { DocumentCopy, DocumentModel, RenderInput } from "@openclaw-crm/document-templates";
import type { QuotationDocumentDetails } from "@/db/schema/quotations";
import { BETRAG } from "@/lib/ohne-preisangaben";
import {
  KV_FELDER_CRM,
  KV_FELDER_VPS,
  KV_LEISTUNGEN_KUECHE,
  KV_LEISTUNGEN_UMZUG,
  KV_ZUSTAENDIG,
  feldDefFuer,
  feldFreigeschaltet,
  kvSchluessel,
  schluesselTeile,
  type AbgleichErgebnis,
  type KvAblehnung,
  type KvAenderung,
  type KvBasis,
  type KvEditorKern,
  type KvFeld,
  type KvFeldDef,
  type KvKonflikt,
  type KvKuecheTextfeld,
  type KvPreisPruefung,
  type KvUnterschiedZeile,
  type KvWert,
  type PruefErgebnis,
  type PushPruefEingabe,
  type PushPruefErgebnis,
  type VpsAngewendet,
  type VpsPaketTeile,
  type Zustaendig,
  type ZusammenfuehrenErgebnis,
} from "@/lib/kv-editor";

type Details = QuotationDocumentDetails;
type Leistungen = NonNullable<Details["services"]>;

/** `DocumentCopy.introText` kommt mit Aufgabe 2c ins Paket; bis dahin lokal erweitert. */
type KvCopy = DocumentCopy & { introText?: string };

const text = (w: unknown): string => (typeof w === "string" ? w : "");

function feldAus(d: KvFeldDef, ziel: string, basis: KvWert, extra?: { gruppe?: string; anhangId?: string }): KvFeld {
  const f: KvFeld = {
    schluessel: kvSchluessel(d.bereich, ziel, d.feld),
    abschnitt: d.abschnitt,
    label: d.label,
    art: d.art,
    basis,
  };
  if (extra?.gruppe !== undefined) f.gruppe = extra.gruppe;
  if (d.max !== undefined) f.max = d.max;
  if (d.art === "zustaendig") f.firmaWaehlbar = basis === "company";
  if (extra?.anhangId !== undefined) f.anhangId = extra.anhangId;
  return f;
}

// ════════════════════════════════════════════════════════════════════════
// VPS
// ════════════════════════════════════════════════════════════════════════

/** Katalog aus dem VPS-Paket, Reihenfolge von `KV_FELDER_VPS`, nur freigeschaltete Schlüssel. */
export function vpsBasis(p: VpsPaketTeile, gepruefte: ReadonlySet<string>): KvBasis {
  const d = p.details;
  const felder: KvFeld[] = [];
  const dazu = (f: KvFeld) => {
    if (feldFreigeschaltet("vps", f.schluessel, gepruefte)) felder.push(f);
  };
  for (const def of KV_FELDER_VPS) {
    const ziel = "fest" in def.ziel ? def.ziel.fest : null;
    switch (def.bereich) {
      case "uebersicht": {
        const basis =
          ziel === "termin"
            ? text(d.time)
            : ziel === "auszug"
              ? text(d.from?.details)
              : ziel === "einzug"
                ? text(d.to?.details)
                : text(p.auftrag.volumen);
        dazu(feldAus(def, ziel!, basis));
        break;
      }
      case "leistungen":
        for (const [key, l] of Object.entries(d.services ?? {})) {
          const basis = def.feld === "notiz" ? text(l.note) : l.owner;
          dazu(feldAus(def, key, basis, { gruppe: KV_LEISTUNGEN_UMZUG[key] ?? key }));
        }
        break;
      case "umzugsgut":
        (d.inventory ?? []).forEach((z, i) => {
          const id = p.inventarIds[i];
          if (!id) return;
          const basis: KvWert =
            def.feld === "bezeichnung"
              ? text(z.name)
              : def.feld === "raum"
                ? text(z.room)
                : def.feld === "notiz"
                  ? text(z.note)
                  : def.feld === "demontage"
                    ? z.dismantling
                    : z.assembly;
          dazu(feldAus(def, id, basis, { gruppe: text(z.name) }));
        });
        break;
      case "bilder":
        p.bildIds.forEach((id, i) => dazu(feldAus(def, id, true, { gruppe: `Foto ${i + 1}`, anhangId: id })));
        break;
      case "vereinbarungen":
        dazu(feldAus(def, ziel!, text(p.auftrag.besonderheiten)));
        break;
      case "kueche":
        if (d.kitchen) dazu(feldAus(def, ziel!, text(d.kitchen[ziel as KvKuecheTextfeld])));
        break;
      case "kueche-leistung":
        for (const [key, l] of Object.entries(d.kitchen?.services ?? {})) {
          const basis = def.feld === "notiz" ? text(l.note) : l.owner;
          dazu(feldAus(def, key, basis, { gruppe: KV_LEISTUNGEN_KUECHE[key] ?? key }));
        }
        break;
      default:
        break;
    }
  }
  return { renderer: "vps", felder };
}

function leistungSetzen(services: Leistungen | undefined, key: string, feld: string, wert: KvWert): void {
  const l = services?.[key];
  if (!l) return;
  if (feld === "notiz" && typeof wert === "string") l.note = wert;
  if (feld === "zustaendig" && typeof wert === "string" && (KV_ZUSTAENDIG as readonly string[]).includes(wert)) {
    l.owner = wert as Zustaendig;
  }
}

/** Wendet die Änderungen auf eine Kopie an; nur die Pfade aus `KvFeldDef.wirkt`. */
export function vpsAnwenden(p: VpsPaketTeile, aenderungen: readonly KvAenderung[]): VpsAngewendet {
  const details = structuredClone(p.details);
  const auftrag = structuredClone(p.auftrag);
  let bildIds = [...p.bildIds];
  for (const a of aenderungen) {
    const t = schluesselTeile(a.schluessel);
    const def = t ? feldDefFuer("vps", a.schluessel) : null;
    if (!t || !def) continue;
    const w = a.wert;
    const s = typeof w === "string" ? w : null;
    switch (t.bereich) {
      case "uebersicht":
        if (s === null) break;
        if (t.ziel === "termin") details.time = s;
        else if (t.ziel === "auszug") details.from = { ...(details.from ?? {}), details: s };
        else if (t.ziel === "einzug") details.to = { ...(details.to ?? {}), details: s };
        else if (t.ziel === "umzugsgut") auftrag.volumen = s;
        break;
      case "leistungen":
        leistungSetzen(details.services, t.ziel, t.feld, w);
        break;
      case "umzugsgut": {
        const i = p.inventarIds.indexOf(t.ziel);
        const z = i >= 0 ? details.inventory?.[i] : undefined;
        if (!z || s === null) break;
        if (t.feld === "bezeichnung") z.name = s;
        else if (t.feld === "raum") z.room = s;
        else if (t.feld === "notiz") z.note = s;
        else if ((KV_ZUSTAENDIG as readonly string[]).includes(s)) {
          if (t.feld === "demontage") z.dismantling = s as Zustaendig;
          else if (t.feld === "montage") z.assembly = s as Zustaendig;
        }
        break;
      }
      case "bilder":
        if (w === false) bildIds = bildIds.filter((id) => id !== t.ziel);
        break;
      case "vereinbarungen":
        if (s !== null) auftrag.besonderheiten = s;
        break;
      case "kueche":
        if (details.kitchen && s !== null) details.kitchen[t.ziel as KvKuecheTextfeld] = s;
        break;
      case "kueche-leistung":
        leistungSetzen(details.kitchen?.services, t.ziel, t.feld, w);
        break;
      default:
        break;
    }
  }
  return { details, auftrag, bildIds };
}

// ════════════════════════════════════════════════════════════════════════
// CRM
// ════════════════════════════════════════════════════════════════════════

/** Katalog aus dem gedruckten Modell ohne Änderungen; die Begrüßung (erste Zeile) gehört nicht dazu. */
export function crmBasis(
  model: Pick<DocumentModel, "intro" | "closing" | "remarks" | "summary">,
  copy: { introText?: string; intro?: string; closing?: string; remarks?: string }
): KvBasis {
  const werte: Record<string, string> = {
    "anschreiben:einleitung:text": copy.introText ?? copy.intro ?? model.intro.slice(1).join("\n\n"),
    "uebersicht:zusammenfassung:text": model.summary ?? "",
    "bemerkungen:text:text": model.remarks ?? "",
    "anschreiben:schluss:text": model.closing.join("\n\n"),
  };
  const felder = KV_FELDER_CRM.map((d) => {
    const ziel = "fest" in d.ziel ? d.ziel.fest : "";
    return feldAus(d, ziel, werte[d.muster] ?? "");
  });
  return { renderer: "crm", felder };
}

/** Wendet die Änderungen auf eine Kopie des Render-Eingangs an (Anschreiben, Bemerkungen, Leistung). */
export function crmAnwenden(input: RenderInput, aenderungen: readonly KvAenderung[]): RenderInput {
  const aus = structuredClone(input);
  const copy: KvCopy = { ...(aus.copy ?? {}) };
  let copyGeaendert = false;
  for (const a of aenderungen) {
    if (typeof a.wert !== "string") continue;
    switch (a.schluessel) {
      case "anschreiben:einleitung:text":
        copy.introText = a.wert;
        delete copy.intro;
        copyGeaendert = true;
        break;
      case "anschreiben:schluss:text":
        copy.closing = a.wert;
        copyGeaendert = true;
        break;
      case "bemerkungen:text:text":
        copy.remarks = a.wert;
        copyGeaendert = true;
        break;
      case "uebersicht:zusammenfassung:text":
        aus.quotation.summary = a.wert;
        break;
      default:
        break;
    }
  }
  if (copyGeaendert) aus.copy = copy;
  return aus;
}

// ════════════════════════════════════════════════════════════════════════
// Preisverdacht (Spec 6.4)
// ════════════════════════════════════════════════════════════════════════

const WORTANFANG =
  /(?<!\p{L})(prozent|rabatt|nachlass|skonto|kostenlos|kostenfrei|gratis|umsonst|unentgeltlich|aufpreis|zuschlag|aufschlag|betrag|kosten|kostet|mehrkosten|bezahl|zahlung|zahlbar|anzahlung|rechnung)/giu;
/** `Kostenvoranschlag` (auch `…schläge`, `…schlags`) ist der Name des Dokuments, kein Preiswort. */
const KOSTENVORANSCHLAG = /^kostenvoranschl(a|ä)g/iu;
const PREIS_IM_WORT = /preis/iu;
const RATE = /(?<!\p{L})raten?(?!\p{L})/iu;
const EURO = /(?<!\p{L})eur(o)?(?![\p{L}-])/iu;
const ZAHL = /\d+(?:[.,]\d+)*/gu;
const DATUM = /^\d{1,2}\.\d{1,2}\.(\d{2}|\d{4})$/u;
const EINHEIT = /^\s?(m²|m³|cbm|qm|cm|mm|km|kg|Stück|Stk|Uhr|m|t|l)(?![\p{L}\d])/iu;

/** Wahr bei Betrag, Prozent, Preis- und Zahlungswörtern, Euro, oder einer dreistelligen Zahl ohne Einheit und ohne Datum. */
export function preisVerdacht(eingabe: string): boolean {
  if (BETRAG.test(eingabe) || eingabe.includes("%")) return true;
  for (const m of eingabe.matchAll(WORTANFANG)) {
    if (m[1].toLowerCase() === "kosten" && KOSTENVORANSCHLAG.test(eingabe.slice(m.index))) continue;
    return true;
  }
  if (PREIS_IM_WORT.test(eingabe) || RATE.test(eingabe) || EURO.test(eingabe)) return true;
  for (const m of eingabe.matchAll(ZAHL)) {
    const zahl = m[0];
    if (zahl.replace(/\D/g, "").length < 3 || DATUM.test(zahl)) continue;
    if (EINHEIT.test(eingabe.slice(m.index + zahl.length))) continue;
    return true;
  }
  return false;
}

// ════════════════════════════════════════════════════════════════════════
// Prüfen und Liste fortschreiben
// ════════════════════════════════════════════════════════════════════════

function pruefeEinen(f: KvFeld, wert: unknown): { ok: KvWert } | { grund: KvAblehnung } {
  switch (f.art) {
    case "text":
    case "langtext": {
      if (typeof wert !== "string") return { grund: "TYP" };
      const w = wert.trim();
      if (f.max !== undefined && w.length > f.max) return { grund: "ZU_LANG" };
      if (w !== f.basis && preisVerdacht(w)) return { grund: "PREIS" };
      return { ok: w };
    }
    case "zustaendig":
      if (typeof wert !== "string" || !(KV_ZUSTAENDIG as readonly string[]).includes(wert)) return { grund: "TYP" };
      if (wert === "company" && !f.firmaWaehlbar) return { grund: "FIRMA_GESPERRT" };
      return { ok: wert };
    case "zeigen":
      if (typeof wert !== "boolean") return { grund: "TYP" };
      if (wert && f.basis === false) return { grund: "TYP" };
      return { ok: wert };
  }
}

/** Prüft Eingaben gegen den Katalog; mehrfach derselbe Schlüssel: der letzte Wert gilt (an der ersten Stelle). */
export function pruefeEingabe(basis: KvBasis, setzen: readonly { schluessel: string; wert: unknown }[]): PruefErgebnis {
  const letzte = new Map<string, unknown>();
  for (const e of setzen) letzte.set(e.schluessel, e.wert);
  const felder = new Map(basis.felder.map((f) => [f.schluessel, f]));
  const aus: PruefErgebnis = { ok: [], abgelehnt: [] };
  for (const [schluessel, wert] of letzte) {
    const f = felder.get(schluessel);
    if (!f) {
      aus.abgelehnt.push({ schluessel, grund: "UNBEKANNT" });
      continue;
    }
    const r = pruefeEinen(f, wert);
    if ("grund" in r) aus.abgelehnt.push({ schluessel, grund: r.grund });
    else aus.ok.push({ schluessel, wert: r.ok, vorher: f.basis });
  }
  return aus;
}

/** Neue vollständige Liste; ein Wert gleich der Basis entfernt die Änderung (Hand und KI). */
export function listeFortschreiben(
  vorher: readonly KvAenderung[],
  ok: readonly { schluessel: string; wert: KvWert; vorher: KvWert }[],
  zuruecksetzen: readonly string[],
  wer: { quelle: "hand" | "ki"; von: string; am: string }
): KvAenderung[] {
  const weg = new Set(zuruecksetzen);
  const liste = vorher.filter((a) => !weg.has(a.schluessel)).map((a) => ({ ...a }));
  for (const e of ok) {
    const i = liste.findIndex((a) => a.schluessel === e.schluessel);
    if (e.wert === e.vorher) {
      if (i >= 0) liste.splice(i, 1);
      continue;
    }
    if (i >= 0 && liste[i].wert === e.wert) continue;
    const neu: KvAenderung = { schluessel: e.schluessel, wert: e.wert, vorher: e.vorher, quelle: wer.quelle, von: wer.von, am: wer.am };
    if (i >= 0) liste[i] = neu;
    else liste.push(neu);
  }
  return liste;
}

// ════════════════════════════════════════════════════════════════════════
// Abgleichen und Zusammenführen (Spec 7.6, Spec 10)
// ════════════════════════════════════════════════════════════════════════

type Bewertung = { liste: KvAenderung } | { konflikt: Pick<KvKonflikt, "art" | "basisJetzt"> };

function bewerte(felder: Map<string, KvFeld>, a: KvAenderung): Bewertung {
  const f = felder.get(a.schluessel);
  if (!f) return { konflikt: { art: "ziel_fehlt", basisJetzt: null } };
  if (f.art === "zustaendig" && a.wert === "company" && !f.firmaWaehlbar) {
    return { konflikt: { art: "nicht_erlaubt", basisJetzt: f.basis } };
  }
  if (f.basis === a.vorher) return { liste: { ...a } };
  if (f.basis === a.wert) return { liste: { ...a, vorher: f.basis } };
  return { konflikt: { art: "basis_geaendert", basisJetzt: f.basis } };
}

/** Liste und offene Konflikte der Quelle gegen den neuen Katalog (Spec 7.6 Schritt 2). */
export function abgleichen(basis: KvBasis, aenderungen: readonly KvAenderung[], offen: readonly KvKonflikt[]): AbgleichErgebnis {
  const felder = new Map(basis.felder.map((f) => [f.schluessel, f]));
  const liste: KvAenderung[] = [];
  const konflikte: KvKonflikt[] = [];
  const nehmen = (a: KvAenderung) => {
    const b = bewerte(felder, a);
    if ("liste" in b) liste.push(b.liste);
    else konflikte.push({ aenderung: { ...a }, art: b.konflikt.art, basisJetzt: b.konflikt.basisJetzt, status: "offen" });
  };
  for (const a of aenderungen) nehmen(a);
  for (const k of offen) {
    if (k.status !== "offen") continue;
    if (liste.some((a) => a.schluessel === k.aenderung.schluessel)) continue;
    nehmen(k.aenderung);
  }
  return { liste, konflikte };
}

const gleich = (x: KvAenderung | undefined, y: KvAenderung | undefined) =>
  x === undefined || y === undefined ? x === y : x.wert === y.wert;

/** Dreiwege nach Spec 10: nur eine Seite geändert → diese; beide gleich → eine; beide verschieden → Konflikt. */
export function zusammenfuehren(
  gemeinsam: readonly KvAenderung[],
  meins: readonly KvAenderung[],
  deren: readonly KvAenderung[]
): ZusammenfuehrenErgebnis {
  const g = new Map(gemeinsam.map((a) => [a.schluessel, a]));
  const m = new Map(meins.map((a) => [a.schluessel, a]));
  const d = new Map(deren.map((a) => [a.schluessel, a]));
  const schluessel = [...new Set([...g.keys(), ...m.keys(), ...d.keys()])];
  const aus: ZusammenfuehrenErgebnis = { liste: [], konflikte: [] };
  for (const s of schluessel) {
    const [gs, ms, ds] = [g.get(s), m.get(s), d.get(s)];
    const wahl = gleich(ms, gs) ? ds : gleich(ds, gs) || gleich(ms, ds) ? ms : null;
    if (wahl === null) aus.konflikte.push({ schluessel: s, meins: ms ?? null, deren: ds ?? null });
    else if (wahl) aus.liste.push({ ...wahl });
  }
  return aus;
}

/** Unterschied zweier Listen, in Katalogreihenfolge, Schlüssel außerhalb des Katalogs hinten. */
export function standUnterschied(
  basis: KvBasis,
  alt: readonly KvAenderung[],
  neu: readonly KvAenderung[]
): KvUnterschiedZeile[] {
  const a = new Map(alt.map((x) => [x.schluessel, x]));
  const n = new Map(neu.map((x) => [x.schluessel, x]));
  const katalog = new Map(basis.felder.map((f) => [f.schluessel, f]));
  const alle = new Set([...a.keys(), ...n.keys()]);
  const reihenfolge = [
    ...basis.felder.map((f) => f.schluessel).filter((s) => alle.has(s)),
    ...[...alle].filter((s) => !katalog.has(s)),
  ];
  const zeilen: KvUnterschiedZeile[] = [];
  for (const s of reihenfolge) {
    const f = katalog.get(s);
    const t = schluesselTeile(s);
    if (!f && !t) continue;
    const ax = a.get(s);
    const nx = n.get(s);
    const basiswert: KvWert = f ? f.basis : (ax ?? nx)!.vorher;
    const vorher = ax ? ax.wert : basiswert;
    const nachher = nx ? nx.wert : basiswert;
    if (vorher === nachher) continue;
    const zeile: KvUnterschiedZeile = {
      schluessel: s,
      abschnitt: f ? f.abschnitt : t!.abschnitt,
      label: f ? f.label : (feldDefFuer(basis.renderer, s)?.label ?? s),
      vorher,
      nachher,
      art: ax && nx ? "geaendert" : nx ? "neu" : "zurueck",
    };
    if (f?.gruppe !== undefined) zeile.gruppe = f.gruppe;
    zeilen.push(zeile);
  }
  return zeilen;
}

// ════════════════════════════════════════════════════════════════════════
// Pushen und Preisprüfung
// ════════════════════════════════════════════════════════════════════════

/** Push-Regeln in der Reihenfolge des Vertrags. */
export function pushPruefung(e: PushPruefEingabe): PushPruefErgebnis {
  if (e.status !== "fertig" || !e.preisOk) return { ok: false, fehler: "STAND_NICHT_FERTIG" };
  if (e.schonGepusht) return { ok: false, fehler: "UNGUELTIG" };
  if (e.aktuellDokumentId !== e.erwartetAktuellDokumentId) return { ok: false, fehler: "AKTUELL_GEAENDERT" };
  if (e.standVersionId !== e.quotationVersionId) return { ok: false, fehler: "KALKULATION_NEU" };
  if (e.annahmeAktiv && !e.annahmeAufhebenBestaetigt) return { ok: false, fehler: "ANNAHME_AKTIV" };
  if (e.annahmeAktiv && !e.admin) return { ok: false, fehler: "NUR_ADMIN" };
  return { ok: true, annahmeAufheben: e.annahmeAktiv };
}

/** Euro (Zahl oder Zahl als Text) in Cent; null, wenn nicht endlich oder nicht größer als null. */
function cent(w: unknown): number | null {
  const n = typeof w === "number" ? w : typeof w === "string" && w.trim() !== "" ? Number(w) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

const sortiert = (xs: Iterable<number>) => [...new Set(xs)].sort((x, y) => x - y);

/** Beträge, die im VPS-PDF stehen müssen (erwartet) und zusätzlich stehen dürfen (erlaubt). */
export function vpsErwarteteBetraege(
  preise: Record<string, unknown>,
  e: { gesamtCent: number | null; bezahltCent: number }
): { erwartetCent: number[]; erlaubtCent: number[] } {
  const erwartet: number[] = [];
  const posten = Array.isArray(preise.pauschale_positionen) ? preise.pauschale_positionen : [];
  for (const p of posten) {
    const c = p && typeof p === "object" ? cent((p as { betrag?: unknown }).betrag) : null;
    if (c !== null) erwartet.push(c);
  }
  for (const k of ["pauschale_betrag", "stundensatz_helfer_eur", "stundensatz_transporter_eur"]) {
    const c = cent(preise[k]);
    if (c !== null) erwartet.push(c);
  }
  const anzahlung = cent(preise.anzahlung_betrag_eur);
  if (anzahlung !== null) erwartet.push(anzahlung);
  if (e.gesamtCent !== null) erwartet.push(e.gesamtCent);

  const erlaubt = [0, e.bezahltCent];
  const wennNichtNegativ = (x: number) => {
    if (x >= 0) erlaubt.push(x);
  };
  if (e.gesamtCent !== null) wennNichtNegativ(e.gesamtCent - e.bezahltCent);
  if (e.gesamtCent !== null && anzahlung !== null) wennNichtNegativ(e.gesamtCent - anzahlung);
  if (anzahlung !== null) wennNichtNegativ(anzahlung - e.bezahltCent);
  return { erwartetCent: sortiert(erwartet), erlaubtCent: sortiert(erlaubt) };
}

const BETRAG_IM_PDF = /([0-9]{1,3}(?:\.[0-9]{3})+|[0-9]+),([0-9]{2})\s?€/g;

/** Vergleicht die Beträge im PDF-Text vor „Vertragsunterlagen“ mit den erwarteten und erlaubten. */
export function vpsPreisPruefung(
  pdfText: string,
  p: { erwartetCent: number[]; erlaubtCent: number[] }
): Pick<KvPreisPruefung, "preis" | "fehlt" | "fremd"> {
  const normal = pdfText.replace(/[  ]/g, " ");
  const ende = normal.indexOf("Vertragsunterlagen");
  const teil = ende >= 0 ? normal.slice(0, ende) : normal;
  if (teil.trim() === "") return { preis: "nicht_lesbar", fehlt: sortiert(p.erwartetCent), fremd: [] };
  const gefunden = new Set<number>();
  for (const m of teil.matchAll(BETRAG_IM_PDF)) {
    gefunden.add(Number(m[1].replace(/\./g, "")) * 100 + Number(m[2]));
  }
  const bekannt = new Set([...p.erwartetCent, ...p.erlaubtCent]);
  const fehlt = sortiert(p.erwartetCent.filter((c) => !gefunden.has(c)));
  const fremd = sortiert([...gefunden].filter((c) => !bekannt.has(c)));
  return { preis: fehlt.length > 0 || fremd.length > 0 ? "abweichung" : "ok", fehlt, fremd };
}

const _vertrag: KvEditorKern = {
  vpsBasis,
  vpsAnwenden,
  crmBasis,
  crmAnwenden,
  abgleichen,
  preisVerdacht,
  pruefeEingabe,
  listeFortschreiben,
  zusammenfuehren,
  standUnterschied,
  pushPruefung,
  vpsErwarteteBetraege,
  vpsPreisPruefung,
};
void _vertrag;

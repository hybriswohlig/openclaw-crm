/**
 * Deal-Kurzfassung der Inbox (Plan 6, Entscheidung 12), reine Logik: aus den
 * Akte-Daten und wenigen Zusatzfakten die rechte Spalte bauen (`Kurzfassung`
 * aus `lib/inbox-neu.ts`). Kein Datenbankzugriff; geladen wird in
 * `services/kurzfassung.ts`.
 *
 * Zeilen kommen aus den Kacheln der Akte (gleiche Texte wie dort), der nächste
 * Schritt aus dem Ablauf. Anzeige deutsch, Trenner „·“, „–“ nur als
 * Platzhalter für einen fehlenden Wert, keine Gedankenstriche im Satz.
 */
import type { AblaufFakten, AblaufSchritt } from "@/lib/ablauf";
import type { AkteDaten, Kachel } from "@/lib/akte";
import type { GespraechKanalArt } from "@/lib/gespraech";
import type { Kurzfassung } from "@/lib/inbox-neu";
import { KEIN_LEAD_STAGE_CATEGORY } from "@/lib/kontaktart";

/** Platzhalter für einen fehlenden Wert. */
const LEER = "–";

type Teil = string | null | undefined | false;

/** Teile ohne Wert entfallen samt Trenner. */
function teile(...xs: Teil[]): string {
  return xs.filter((x): x is string => typeof x === "string" && x.trim() !== "").join(" · ");
}

// ─── Zeilen ───────────────────────────────────────────────────────────────────

/**
 * Wartet aus der Kachel der Akte: „auf uns · 35 Min“ (gold), „auf Kunden ·
 * 2 Tage“, „läuft“; bei Verloren/Kein Lead „abgeschlossen“.
 */
export function wartetZeile(k: Kachel | undefined): { wert: string; ton: "gold" | null } {
  if (!k) return { wert: LEER, ton: null };
  const dauer = k.wert !== LEER ? k.wert : null;
  if (k.label === "Wartet auf uns") return { wert: teile("auf uns", dauer), ton: "gold" };
  if (k.label === "Wartet auf Kunden") return { wert: teile("auf Kunden", dauer), ton: null };
  if (k.label === "Läuft") return { wert: "läuft", ton: null };
  return { wert: k.zeile || LEER, ton: null };
}

/** Umzug (auch Entrümpelung und Umzug) → „Umzugsdatum“, sonst „Termin“. */
export function terminLabel(leistung: AblaufFakten["leistung"]): string {
  return leistung === "move" || leistung === "clearance_move" ? "Umzugsdatum" : "Termin";
}

/**
 * Die fünf Zeilen der Deal-Karte in fester Reihenfolge: Kostenvoranschlag
 * („2.480 € · v2“), Umzugsdatum bzw. Termin, Volumen, Marge, Wartet.
 */
export function kurzfassungZeilen(
  kacheln: readonly Kachel[],
  e: { leistung: AblaufFakten["leistung"]; kvVersion: number | null }
): Kurzfassung["zeilen"] {
  const k = (key: Kachel["key"]) => kacheln.find((x) => x.key === key);
  const wert = (key: Kachel["key"]) => k(key)?.wert || LEER;
  const kv = wert("kv");
  const wartet = wartetZeile(k("wartet"));
  return [
    { label: "Kostenvoranschlag", wert: kv === LEER ? LEER : teile(kv, e.kvVersion !== null && `v${e.kvVersion}`), ton: null },
    { label: terminLabel(e.leistung), wert: wert("termin"), ton: null },
    { label: "Volumen", wert: wert("volumen"), ton: null },
    { label: "Marge", wert: wert("marge"), ton: null },
    { label: "Wartet", wert: wartet.wert, ton: wartet.ton },
  ];
}

// ─── Nächster Schritt ─────────────────────────────────────────────────────────

/**
 * Der Schritt `jetzt` des Ablaufs mit seiner Zeile; null, wenn keiner (alles
 * erledigt, Verloren, Kein Lead). Ist der KV gesendet und noch nicht
 * angenommen (Schritt 4 `jetzt` mit Hinweis), liegt der nächste Schritt beim
 * Kunden: dann die Annahme („Annahme · im Status-Link“). Dazu der nächste
 * geplante Nachfass („Nachfass Tag 2 morgen“).
 */
export function naechsterSchrittAus(schritte: readonly AblaufSchritt[]): Kurzfassung["naechsterSchritt"] {
  const jetzt = schritte.find((s) => s.zustand === "jetzt");
  if (!jetzt) return null;
  const schritt = (jetzt.key === "kv" && jetzt.hinweis && schritte.find((s) => s.key === "annahme")) || jetzt;
  const nachfass = jetzt.sequenz?.find((q) => q.art !== "gesendet");
  const zusatz = teile(schritt.zeile, nachfass && `Nachfass Tag ${nachfass.tag} ${nachfass.wann}`);
  return { titel: schritt.titel, zusatz: zusatz || null };
}

// ─── Gespräch-Karte ───────────────────────────────────────────────────────────

const KANAL_LABEL: Record<GespraechKanalArt, string> = { whatsapp: "WhatsApp", email: "E-Mail", sms: "SMS" };
const KANAL_FOLGE: GespraechKanalArt[] = ["whatsapp", "email", "sms"];

/** „WhatsApp, E-Mail, 2 Anrufe“; nichts → „–“. */
export function kanaeleText(kanaele: readonly GespraechKanalArt[], anrufe: number): string {
  const da = new Set(kanaele);
  const teileListe = KANAL_FOLGE.filter((k) => da.has(k)).map((k) => KANAL_LABEL[k]);
  if (anrufe > 0) teileListe.push(anrufe === 1 ? "1 Anruf" : `${anrufe} Anrufe`);
  return teileListe.length > 0 ? teileListe.join(", ") : LEER;
}

const DOKUMENT_KURZ: [typ: string, kurz: string][] = [
  ["quotation", "KV"],
  ["order_confirmation", "AB"],
  ["invoice", "RE"],
  ["payment_confirmation", "ZB"],
  ["signed_contract", "Vertrag"],
  ["worker_instructions", "Crew"],
];

/**
 * „KV v1, v2 · AB · RE“: je Dokumentart einmal in fester Reihenfolge; beim KV
 * die Versionen der Kalkulation, aus denen die Dokumente entstanden (ohne
 * Version nur „KV“). Unbekannte Arten entfallen; nichts → „–“.
 */
export function dokumenteText(dokumente: readonly { typ: string; version: number | null }[]): string {
  const teileListe: string[] = [];
  for (const [typ, kurz] of DOKUMENT_KURZ) {
    const passend = dokumente.filter((d) => d.typ === typ);
    if (passend.length === 0) continue;
    if (typ !== "quotation") {
      teileListe.push(kurz);
      continue;
    }
    const versionen = [...new Set(passend.map((d) => d.version).filter((v): v is number => v !== null))].sort((a, b) => a - b);
    teileListe.push(versionen.length > 0 ? `KV ${versionen.map((v) => `v${v}`).join(", ")}` : "KV");
  }
  return teileListe.length > 0 ? teileListe.join(" · ") : LEER;
}

// ─── Kunde ────────────────────────────────────────────────────────────────────

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ") : null;
}

/**
 * Volle Adresse: Freitext wie gespeichert, `LocationValue` als „Straße,
 * Zusatz, PLZ Ort“ (PLZ und Ort nur, wenn sie nicht schon in der Straße
 * stehen). Leer → null.
 */
export function adresseText(adresse: unknown): string | null {
  if (typeof adresse === "string") return text(adresse);
  if (!adresse || typeof adresse !== "object" || Array.isArray(adresse)) return null;
  const o = adresse as Record<string, unknown>;
  const zeile1 = text(o.line1);
  const zeile2 = text(o.line2);
  const plz = text(o.postcode);
  const ort = text(o.city);
  const schonDrin = (x: string | null) => !x || (zeile1 ?? "").includes(x);
  const ortTeil = schonDrin(plz) && schonDrin(ort) ? null : [plz, ort].filter(Boolean).join(" ");
  const out = [zeile1, zeile2, ortTeil].filter((x): x is string => Boolean(x)).join(", ");
  return out || null;
}

// ─── Ganze Kurzfassung ────────────────────────────────────────────────────────

export interface KurzfassungEingabe {
  dealId: string;
  akte: Pick<AkteDaten, "kopf" | "kacheln" | "ablauf" | "nachfass" | "firma">;
  leistung: AblaufFakten["leistung"];
  kvVersion: number | null;
  quelle: string | null;
  kunde: { telefon: string | null; email: string | null; von: unknown; nach: unknown };
  kanaele: GespraechKanalArt[];
  anrufe: number;
  fotos: number;
  dokumente: { typ: string; version: number | null }[];
}

export function kurzfassungAus(e: KurzfassungEingabe): Kurzfassung {
  const { kopf } = e.akte;
  return {
    dealId: e.dealId,
    name: kopf.name,
    stufe: { id: kopf.stufe.id, label: kopf.stufe.label, ton: kopf.stufe.ton },
    zeilen: kurzfassungZeilen(e.akte.kacheln, { leistung: e.leistung, kvVersion: e.kvVersion }),
    naechsterSchritt: naechsterSchrittAus(e.akte.ablauf.schritte),
    kunde: {
      telefon: text(e.kunde.telefon),
      email: text(e.kunde.email),
      von: adresseText(e.kunde.von),
      nach: adresseText(e.kunde.nach),
      quelle: text(e.quelle),
      firma: text(e.akte.firma.name),
    },
    gespraech: {
      kanaele: kanaeleText(e.kanaele, e.anrufe),
      fotos: e.fotos,
      dokumente: dokumenteText(e.dokumente),
    },
    nachfass: { an: e.akte.nachfass.an, modus: e.akte.nachfass.modus, text: e.akte.nachfass.text },
    keinLeadStufeId: kopf.stufen.find((s) => s.kategorie === KEIN_LEAD_STAGE_CATEGORY)?.id ?? null,
    kategorie: kopf.stufe.kategorie,
    akteLink: `/app/leads/${e.dealId}`,
  };
}

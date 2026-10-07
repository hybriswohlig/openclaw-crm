import type { KartenOrt, OrtGenauigkeit } from "@/lib/lagekarte/typen";
import tabelle from "./plz-de.json";

export interface PlzEintrag {
  lat: number;
  lng: number;
  ags: string;
  name: string;
}

export interface AdressRoh {
  postcode?: string | null;
  city?: string | null;
  line1?: string | null;
}

export interface ImmoscoutRoh {
  zip?: string | null;
  city?: string | null;
  street?: string | null;
}

type PlzZeile = [number, number, string, string];

const PLZ_TABELLE = tabelle as unknown as Record<string, PlzZeile>;

function istBw(ags: string): boolean {
  return ags.startsWith("08");
}

function alsEintrag(zeile: PlzZeile): PlzEintrag {
  return { lat: zeile[0], lng: zeile[1], ags: zeile[2], name: zeile[3] };
}

export function plzEintrag(plz: string | null | undefined): PlzEintrag | null {
  if (typeof plz !== "string") return null;
  const sauber = plz.trim();
  if (!/^\d{5}$/.test(sauber)) return null;
  const zeile = Object.hasOwn(PLZ_TABELLE, sauber) ? PLZ_TABELLE[sauber] : undefined;
  return zeile ? alsEintrag(zeile) : null;
}

export function findePlzImText(text: string | null | undefined): string | null {
  if (!text) return null;
  const treffer = (text.match(/\b\d{5}\b/g) ?? []).filter((p) => plzEintrag(p) !== null);
  if (treffer.length === 0) return null;
  return treffer.find((p) => istBw(plzEintrag(p)!.ags)) ?? treffer[0];
}

// ---------------------------------------------------------------------------
// Ortsnamen-Index (nur Baden-Württemberg)
// ---------------------------------------------------------------------------

function normalisiere(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

interface IndexEintrag {
  /** Name des ersten Eintrags, dessen normalisierter Name genau dem Schlüssel entspricht. */
  name: string;
  kandidaten: PlzEintrag[];
}

let ortsIndex: Map<string, IndexEintrag> | null = null;

function baueIndex(): Map<string, IndexEintrag> {
  const bwEintraege = Object.values(PLZ_TABELLE)
    .filter((zeile) => istBw(zeile[2]))
    .map(alsEintrag);

  const index = new Map<string, IndexEintrag>();
  const woerter = new Map<PlzEintrag, string[]>();
  for (const eintrag of bwEintraege) {
    const schluessel = normalisiere(eintrag.name);
    if (!schluessel) continue;
    woerter.set(eintrag, schluessel.split(" "));
    const vorhanden = index.get(schluessel);
    if (vorhanden) vorhanden.kandidaten.push(eintrag);
    else index.set(schluessel, { name: eintrag.name, kandidaten: [eintrag] });
  }

  // Stadtteile ("Stuttgart-West", "Stuttgart Vaihingen") zählen zusätzlich zum Stadtnamen,
  // sofern der Stadtname selbst als Ortsname in der Tabelle steht.
  for (const [eintrag, w] of woerter) {
    for (let n = 1; n < w.length; n++) {
      const stamm = index.get(w.slice(0, n).join(" "));
      if (stamm) stamm.kandidaten.push(eintrag);
    }
  }
  return index;
}

function sucheSchluessel(index: Map<string, IndexEintrag>, schluessel: string): PlzEintrag | null {
  if (!schluessel) return null;
  const treffer = index.get(schluessel);
  if (!treffer) return null;
  const ags = treffer.kandidaten[0].ags;
  if (treffer.kandidaten.some((k) => k.ags !== ags)) return null;
  const n = treffer.kandidaten.length;
  return {
    lat: treffer.kandidaten.reduce((s, k) => s + k.lat, 0) / n,
    lng: treffer.kandidaten.reduce((s, k) => s + k.lng, 0) / n,
    ags,
    name: treffer.name,
  };
}

export function findeOrtsname(text: string | null | undefined): PlzEintrag | null {
  if (!text || !text.trim()) return null;
  ortsIndex ??= baueIndex();

  const stuecke = text.split(",").map(normalisiere).filter(Boolean);
  const kandidaten = [
    normalisiere(text),
    ...stuecke,
    ...stuecke.map((s) => s.slice(s.lastIndexOf(" ") + 1)),
  ];
  for (const schluessel of kandidaten) {
    const treffer = sucheSchluessel(ortsIndex, schluessel);
    if (treffer) return treffer;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Versatz
// ---------------------------------------------------------------------------

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministischer Versatz (40 bis 250 m), damit Leads derselben PLZ nicht exakt übereinanderliegen. */
export function versatz(leadId: string, lat: number, lng: number): { lat: number; lng: number } {
  const h = fnv1a(leadId);
  const winkel = ((h % 360) * Math.PI) / 180;
  const meter = 40 + ((h >>> 9) % 211);
  const dLat = (meter * Math.cos(winkel)) / 111320;
  const dLng = (meter * Math.sin(winkel)) / (111320 * Math.cos((lat * Math.PI) / 180));
  const runde = (v: number) => Math.round(v * 1e5) / 1e5;
  return { lat: runde(lat + dLat), lng: runde(lng + dLng) };
}

// ---------------------------------------------------------------------------
// Auflösung
// ---------------------------------------------------------------------------

type Treffer = Pick<KartenOrt, "plz" | "genauigkeit" | "ortsname" | "kreisAgs"> & { punkt: PlzEintrag };

function ausPlz(plz: string | null | undefined): Treffer | null {
  const sauber = typeof plz === "string" ? plz.trim() : null;
  const e = plzEintrag(sauber);
  if (!e || !sauber) return null;
  return { plz: sauber, genauigkeit: "plz", ortsname: e.name, kreisAgs: e.ags, punkt: e };
}

function ausOrtsname(...texte: Array<string | null | undefined>): Treffer | null {
  for (const text of texte) {
    const e = findeOrtsname(text);
    if (e) return { plz: null, genauigkeit: "ort", ortsname: e.name, kreisAgs: e.ags, punkt: e };
  }
  return null;
}

function freitext(...teile: Array<string | null | undefined>): string {
  return teile.filter(Boolean).join(" ");
}

function alsKartenOrt(
  t: Treffer,
  leadId: string,
  quelle: KartenOrt["quelle"],
): KartenOrt {
  const { lat, lng } = versatz(leadId, t.punkt.lat, t.punkt.lng);
  const genauigkeit: OrtGenauigkeit = t.genauigkeit;
  return { lat, lng, plz: t.plz, ortsname: t.ortsname, kreisAgs: t.kreisAgs, genauigkeit, quelle };
}

export function loeseOrte(input: {
  leadId: string;
  abholung: AdressRoh | null;
  immoscoutVon: ImmoscoutRoh | null;
  ziel: AdressRoh | null;
  immoscoutNach: ImmoscoutRoh | null;
}): { ort: KartenOrt | null; ziel: KartenOrt | null } {
  const { leadId, abholung, immoscoutVon, ziel, immoscoutNach } = input;

  const zielTreffer =
    ausPlz(ziel?.postcode) ??
    ausPlz(findePlzImText(freitext(ziel?.line1, ziel?.city))) ??
    ausPlz(immoscoutNach?.zip) ??
    ausOrtsname(ziel?.city, ziel?.line1, immoscoutNach?.city);
  const zielOrt = zielTreffer ? alsKartenOrt(zielTreffer, `${leadId}:ziel`, "zieladresse") : null;

  const abholOrt = ((): KartenOrt | null => {
    const a = ausPlz(abholung?.postcode);
    if (a) return alsKartenOrt(a, leadId, "abholadresse");
    const f = ausPlz(findePlzImText(freitext(abholung?.line1, abholung?.city)));
    if (f) return alsKartenOrt(f, leadId, "freitext");
    const i = ausPlz(immoscoutVon?.zip);
    if (i) return alsKartenOrt(i, leadId, "immoscout");
    const o = ausOrtsname(abholung?.city, abholung?.line1, immoscoutVon?.city);
    if (o) return alsKartenOrt(o, leadId, "ortsname");
    return zielOrt ? { ...zielOrt, quelle: "zieladresse" } : null;
  })();

  return { ort: abholOrt, ziel: zielOrt };
}

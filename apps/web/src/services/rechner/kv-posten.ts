/**
 * Posten, Leistungen und Gültigkeit für den Kostenvoranschlag (Owner-Wunsch
 * 2026-09-29, Recherche policy/customer-texting/research-funnel.md §5).
 *
 * Kern + Hebel: ein Kernposten (Team, Fahrzeug, Anfahrt, alle Kilometer,
 * Möbelschutz, Tragewege) und wenige Hebel, die der Kunde sieht und notfalls
 * weglassen kann (Montage, Halteverbot, Einpacken, Küche). Verhandelt wird so
 * über den Umfang, nie über einen Rabatt. Die Summe der Posten ist immer genau
 * der Festpreis. Reine Funktionen, kein I/O.
 */
import type { RechnerErgebnis } from "./client";
import type { RechnerAnfrage } from "./eingabe";

export type LeistungsTraeger = "company" | "customer" | "none";
export type KvLeistungen = Record<string, { owner: LeistungsTraeger; note?: string }>;

export interface KvPosten {
  description: string;
  quantity: number;
  /** Einzelpreis in Euro */
  unitRate: number;
}

export type HebelArt = "montage" | "halteverbot" | "einpacken" | "kueche";

export interface KvOptionen {
  /** Demontage/Montage macht der Kunde selbst */
  ohneMontage?: boolean;
  /** Halteverbot besorgt der Kunde selbst */
  ohneHalteverbot?: boolean;
}

export interface KvBausteine {
  posten: KvPosten[];
  /** Summe der Posten = Festpreis im KV */
  summe: number;
  kern: number;
  hebel: Array<{ art: HebelArt; betrag: number }>;
  /** Um so viel ist der Preis durch "ohne …" gesunken (0, wenn der Endpreis vorgegeben war) */
  abzug: number;
  /** Selbstkosten, die durch "ohne …" wegfallen (für die Mindestmarge) */
  entfalleneKosten: number;
  leistungen: KvLeistungen;
  /** Möbel, die laut Kalkulation zerlegt werden */
  montageMoebel: string[];
  /** true: wir bauen sie ab und auf; false: der Kunde ("ohne montage") */
  montageDurchUns: boolean;
}

const ARBEITSSATZ_STANDARD = 35;
const HALTEVERBOT_STANDARD = 150;
/** Der Kern muss mindestens diesen Anteil haben, sonst wirkt der KV zerstückelt: dann ein einziger Posten. */
const KERN_MIN_ANTEIL = 0.5;

const auf10 = (n: number) => Math.ceil(n / 10) * 10;
/** Auf ganze Cent; Posten werden mit zwei Nachkommastellen gespeichert. */
const cent = (n: number) => Math.round(n * 100) / 100;
const inCent = (n: number) => Math.round(n * 100);

export function aufzaehlen(teile: readonly string[]): string {
  if (teile.length <= 1) return teile.join("");
  return `${teile.slice(0, -1).join(", ")} und ${teile[teile.length - 1]}`;
}

/** "Lerchenstraße 78, 70176 Stuttgart" → "Lerchenstraße 78" */
export function strasseAus(adresse: unknown): string | null {
  if (typeof adresse !== "string") return null;
  const teil = adresse.split(",")[0]?.trim();
  return teil ? teil : null;
}

function an(anfrage: RechnerAnfrage, feld: string): boolean {
  return anfrage[feld] === "on";
}

function moebelText(namen: readonly string[]): string {
  if (namen.length <= 4) return aufzaehlen(namen);
  return `${namen.slice(0, 3).join(", ")} und ${namen.length - 3} weitere Möbel`;
}

/**
 * Posten und Leistungen aus der Kalkulation. `festpreis` enthält alle Hebel.
 * Mit "ohne …" fällt der Hebel weg; ist `festpreisIstEndpreis` gesetzt (der
 * Inhaber hat den Preis vorgegeben), bleibt der Preis, sonst sinkt er um den Hebel.
 */
export function kvBausteine(input: {
  festpreis: number;
  ergebnis: Pick<RechnerErgebnis, "preis" | "kosten" | "zeiten" | "team" | "positionen" | "fahrzeugoptionen" | "empfehlungOptionId">;
  anfrage: RechnerAnfrage;
  optionen?: KvOptionen;
  festpreisIstEndpreis?: boolean;
}): KvBausteine {
  const { ergebnis: e, anfrage } = input;
  const opt = input.optionen ?? {};
  const listenPosten = e.preis?.posten ?? [];
  const arbeitssatz = listenPosten.find((p) => /^Arbeitsstunden/.test(p.bezeichnung))?.satz ?? ARBEITSSATZ_STANDARD;
  const zeiten = e.zeiten ?? {};

  // ── Hebel ──
  const kandidaten: Array<{ art: HebelArt; posten: KvPosten }> = [];
  const montageMoebel = [...new Set((e.positionen ?? []).filter((p) => p.zerlegt).map((p) => p.name.trim()).filter(Boolean))];
  const montagePm = (zeiten.demontage ?? 0) + (zeiten.montage ?? 0);
  if (montageMoebel.length > 0 && montagePm > 0) {
    kandidaten.push({
      art: "montage",
      posten: {
        description: `Demontage & Montage (${moebelText(montageMoebel)})`,
        quantity: 1,
        unitRate: Math.max(40, auf10((montagePm / 60) * arbeitssatz)),
      },
    });
  }
  const zonen = [an(anfrage, "von_halteverbot") ? strasseAus(anfrage.von_adresse) ?? "Auszug" : null, an(anfrage, "nach_halteverbot") ? strasseAus(anfrage.nach_adresse) ?? "Einzug" : null].filter(
    (z): z is string => z !== null
  );
  if (zonen.length > 0) {
    const satz = listenPosten.find((p) => p.bezeichnung === "Halteverbotszone")?.satz ?? HALTEVERBOT_STANDARD;
    kandidaten.push({
      art: "halteverbot",
      posten: {
        description: `Halteverbotszone inkl. Beantragung und Schildern (${aufzaehlen(zonen)})`,
        quantity: zonen.length,
        unitRate: cent(satz),
      },
    });
  }
  const kartons = Number(anfrage.einpack_kartons);
  if (Number.isFinite(kartons) && kartons > 0 && (zeiten.packen ?? 0) > 0) {
    kandidaten.push({
      art: "einpacken",
      posten: { description: `Einpackservice (${kartons} Kartons)`, quantity: 1, unitRate: auf10(((zeiten.packen ?? 0) / 60) * arbeitssatz) },
    });
  }
  const kueche = listenPosten.find((p) => p.bezeichnung === "Küche Demontage/Montage");
  if (kueche && kueche.betrag > 0) {
    kandidaten.push({
      art: "kueche",
      posten: { description: `Küche: Abbau und Aufbau${kueche.menge ? ` (${kueche.menge} m)` : ""}`, quantity: 1, unitRate: auf10(kueche.betrag) },
    });
  }

  // Ein Hebel ohne sinnvollen Satz (0, negativ, kaputt) wird kein eigener Posten:
  // er bleibt im Kern, sonst verschöbe er die Summe im KV.
  for (let i = kandidaten.length - 1; i >= 0; i--) {
    const r = kandidaten[i].posten.unitRate;
    if (!Number.isFinite(r) || r <= 0) kandidaten.splice(i, 1);
  }

  const weg = (art: HebelArt) => (art === "montage" && opt.ohneMontage) || (art === "halteverbot" && opt.ohneHalteverbot);
  // Kosten, die wirklich wegfallen: Zonen zum Kostensatz, Montagezeit zum internen Stundensatz.
  const kostenPosten = e.kosten?.posten ?? [];
  const entfalleneKosten =
    (kandidaten.some((k) => k.art === "halteverbot" && weg(k.art))
      ? zonen.length * (kostenPosten.find((p) => p.bezeichnung === "Halteverbotszone")?.satz ?? 0)
      : 0) +
    (kandidaten.some((k) => k.art === "montage" && weg(k.art))
      ? (montagePm / 60) * (kostenPosten.find((p) => /^Personal/.test(p.bezeichnung))?.satz ?? 0)
      : 0);
  const betrag = (p: KvPosten) => p.unitRate * p.quantity;
  const abzug = input.festpreisIstEndpreis ? 0 : kandidaten.filter((k) => weg(k.art)).reduce((s, k) => s + betrag(k.posten), 0);
  const summe = cent(input.festpreis - abzug);
  let hebel = kandidaten.filter((k) => !weg(k.art));
  // Kern als Rest in ganzen Cent: so ergeben die gespeicherten Posten genau den Festpreis.
  let kern = (inCent(summe) - hebel.reduce((s, k) => s + inCent(k.posten.unitRate) * k.posten.quantity, 0)) / 100;

  // ── Kernposten ──
  const option = e.fahrzeugoptionen?.find((o) => o.id === e.empfehlungOptionId) ?? null;
  const team = option?.teamgroesse ?? e.team?.groesse ?? null;
  const fahrzeug = option && /lkw/i.test(option.name) ? "LKW" : "Transporter";
  const kernText = `Umzugsteam${team ? ` (${team} Personen)` : ""} & ${fahrzeug}, inkl. Anfahrt, aller Kilometer, Möbelschutz und Tragewege`;
  let kernPosten: KvPosten = { description: kernText, quantity: 1, unitRate: kern };
  if (kern < summe * KERN_MIN_ANTEIL) {
    // Hebel zu groß im Verhältnis: ein Posten mit allem, damit kein Teil billiger wirkt als der Rest.
    const drin = hebel.map((k) => (k.art === "montage" ? "Demontage & Montage" : k.art === "halteverbot" ? "Halteverbotszone" : k.art === "einpacken" ? "Einpackservice" : "Küche"));
    kernPosten = { description: `${kernText}${drin.length ? `, ${aufzaehlen(drin)}` : ""}`, quantity: 1, unitRate: summe };
    hebel = [];
    kern = summe;
  }

  // ── Leistungen im KV ──
  const montageDabei = montageMoebel.length > 0 && !opt.ohneMontage;
  const leistungen: KvLeistungen = {
    transport: {
      owner: "company",
      note: `Be- und Entladen sowie Transport Ihres Umzugsguts laut Umzugsgutliste${team ? `, mit ${team} Personen` : ""}, inkl. Möbelschutz mit Decken und Folie.`,
    },
    dismantling: montageMoebel.length === 0 ? { owner: "none" } : montageDabei ? { owner: "company", note: `${aufzaehlen(montageMoebel)}.` } : { owner: "customer", note: "Den Abbau übernehmen Sie selbst." },
    assembly: montageMoebel.length === 0 ? { owner: "none" } : montageDabei ? { owner: "company", note: `${aufzaehlen(montageMoebel)}.` } : { owner: "customer", note: "Den Aufbau übernehmen Sie selbst." },
    parkingPickup: parkplatz(an(anfrage, "von_halteverbot"), opt.ohneHalteverbot, strasseAus(anfrage.von_adresse)),
    parkingDestination: parkplatz(an(anfrage, "nach_halteverbot"), opt.ohneHalteverbot, strasseAus(anfrage.nach_adresse)),
    packing: Number.isFinite(kartons) && kartons > 0 ? { owner: "company", note: `Einpacken von ca. ${kartons} Kartons.` } : { owner: "customer", note: "Ihre Umzugskartons packen Sie selbst." },
    unpacking: { owner: "customer" },
    materials: Number.isFinite(kartons) && kartons > 0 ? { owner: "company" } : { owner: "none" },
  };

  return {
    posten: [kernPosten, ...hebel.map((k) => k.posten)],
    summe,
    kern,
    hebel: hebel.map((k) => ({ art: k.art, betrag: betrag(k.posten) })),
    abzug,
    entfalleneKosten: Math.round(entfalleneKosten * 100) / 100,
    leistungen,
    montageMoebel,
    montageDurchUns: montageDabei,
  };
}

function parkplatz(gerechnet: boolean, ohne: boolean | undefined, strasse: string | null): { owner: LeistungsTraeger; note?: string } {
  if (!gerechnet) return { owner: "none" };
  if (ohne) return { owner: "customer", note: `Parkmöglichkeit für den Transporter direkt vor dem Haus${strasse ? ` (${strasse})` : ""} stellen Sie sicher.` };
  return { owner: "company", note: `Halteverbotszone${strasse ? ` ${strasse}` : ""}, inkl. Beantragung bei der Stadt und Aufstellen der Schilder.` };
}

// ─── Gültigkeit und Termin-Hinweise ─────────────────────────────────────────

const TAG_MS = 24 * 60 * 60_000;

function tag(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}
function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
function istDatum(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Tage von heute bis zum Umzug (negativ = vorbei), null ohne Datum. */
export function tageBisUmzug(heute: string, umzugsdatum: unknown): number | null {
  if (!istDatum(umzugsdatum)) return null;
  return Math.round((tag(umzugsdatum) - tag(heute)) / TAG_MS);
}

/**
 * Gültig 7 Tage, aber nie über den Tag vor dem Umzug hinaus (ein 7-Tage-KV für
 * einen Umzug in 3 Tagen ergibt keinen Sinn). Umzug heute oder morgen: nur heute.
 */
export function kvGueltigBis(heute: string, umzugsdatum: unknown): { datum: string; hinweis: string | null } {
  const plus7 = iso(tag(heute) + 7 * TAG_MS);
  const tage = tageBisUmzug(heute, umzugsdatum);
  if (tage === null) return { datum: plus7, hinweis: null };
  if (tage < 0) return { datum: plus7, hinweis: "Das Umzugsdatum liegt in der Vergangenheit, bitte prüfen." };
  if (tage <= 1) return { datum: heute, hinweis: `Umzug ${tage === 0 ? "heute" : "morgen"}: Der KV gilt nur heute.` };
  const vorTag = iso(tag(umzugsdatum as string) - TAG_MS);
  return vorTag < plus7
    ? { datum: vorTag, hinweis: `Umzug in ${tage} Tagen: Der KV gilt bis zum Vortag.` }
    : { datum: plus7, hinweis: null };
}

/** Warnung, wenn die Halteverbotszone vermutlich nicht mehr rechtzeitig genehmigt wird. */
export function halteverbotVorlaufHinweis(heute: string, umzugsdatum: unknown, zonen: number): string | null {
  if (zonen <= 0) return null;
  const tage = tageBisUmzug(heute, umzugsdatum);
  if (tage === null || tage < 0 || tage >= 14) return null;
  return `Halteverbot: Umzug in ${tage} Tagen, die Genehmigung dauert in Stuttgart oft rund 2 Wochen. Vor dem Senden klären, ob die Zone rechtzeitig steht.`;
}

/** "2026-10-06" → "06.10.2026" */
export function datumDeutsch(isoDatum: string): string {
  return `${isoDatum.slice(8, 10)}.${isoDatum.slice(5, 7)}.${isoDatum.slice(0, 4)}`;
}

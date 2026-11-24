/**
 * Posten je Kundenwahl und Stunden-Posten (Plan 5b, Entscheidung 6 und 7).
 * Der Preis kommt aus der Version. Der Kern fängt die Rundung, damit die
 * Posten auf den Cent genau den Preis der Wahl ergeben.
 */
import type { RechnerStunden, StundenAngebot, Tagespreis, VersionsPreise } from "@/lib/angebot-wahl";
import { anfrageOhneZuschlagFelder, gutschriftEur } from "@/lib/entruempelung-zuschlaege";
import type { RechnerErgebnis } from "./client";
import type { RechnerAnfrage } from "./eingabe";
import { kvBausteine, type HebelArt, type KvPosten } from "./kv-posten";

const inCent = (eur: number) => Math.round(eur * 100);
const postenCent = (posten: readonly KvPosten[]) => posten.reduce((s, p) => s + inCent(p.unitRate) * p.quantity, 0);

function angleichen(posten: KvPosten[], zielCent: number): KvPosten[] {
  if (posten.length === 0 || posten[0]!.quantity !== 1) return posten;
  const diff = zielCent - postenCent(posten);
  if (diff === 0) return posten;
  const kern = posten[0]!;
  return [{ ...kern, unitRate: (inCent(kern.unitRate) + diff) / 100 }, ...posten.slice(1)];
}

/** Heutiger Sammeltext: die eine Zeile, die beim Zusammenklappen entsteht. */
function sammeltext(
  ergebnis: RechnerErgebnis,
  anfrage: RechnerAnfrage,
  hebelNur: HebelArt[] | undefined
): string {
  const vorlage = kvBausteine({
    festpreis: 1,
    ergebnis,
    anfrage: anfrageOhneZuschlagFelder(anfrage),
    festpreisIstEndpreis: true,
    ...(hebelNur === undefined ? {} : { hebelNur }),
    zusammenklappen: "kern_min",
  });
  return vorlage.posten[0]?.description ?? "";
}

/** Ziel nach der Gutschrift. Ohne Gutschrift derselbe Cent, damit bestehende Preise stehen bleiben. */
function zielNachGutschrift(zielCent: number, anfrage: RechnerAnfrage): number {
  const credit = Math.round(gutschriftEur(anfrage) * 100);
  if (credit <= 0) return zielCent;
  return Math.max(0, zielCent - credit);
}

function postenFuer(input: {
  zielCent: number;
  ergebnis: RechnerErgebnis;
  anfrage: RechnerAnfrage;
  hebelNur: HebelArt[] | undefined;
  einPosten: boolean;
}): { posten: KvPosten[]; summeCent: number } {
  const nettoCent = zielNachGutschrift(input.zielCent, input.anfrage);
  if (input.einPosten) {
    return {
      posten: angleichen(
        [
          {
            description: sammeltext(input.ergebnis, input.anfrage, input.hebelNur),
            quantity: 1,
            unitRate: nettoCent / 100,
          },
        ],
        nettoCent
      ),
      summeCent: nettoCent,
    };
  }
  const gebaut = kvBausteine({
    festpreis: input.zielCent / 100,
    ergebnis: input.ergebnis,
    anfrage: input.anfrage,
    festpreisIstEndpreis: true,
    ...(input.hebelNur === undefined ? {} : { hebelNur: input.hebelNur }),
    zusammenklappen: "nie",
  });
  // Kern ≤ 0 bleibt draussen. Ihn auf einen Hebel zu schieben würde den Hebel verfälschen.
  // Ohne Gutschrift bleibt der Preis der Wahl, auch wenn der Kern nicht positiv ist.
  if (gebaut.kern <= 0) {
    return { posten: gebaut.posten, summeCent: gutschriftEur(input.anfrage) > 0 ? inCent(gebaut.summe) : input.zielCent };
  }
  return { posten: angleichen(gebaut.posten, nettoCent), summeCent: nettoCent };
}

function ziel(euro: number | null): number | null {
  return euro === null ? null : inCent(euro);
}

/**
 * Füllt die Posten jeder Wahl. Hebel eines Pakets kommen aus `paketHebel`
 * (Basis: keine). Tag und Hauptpreis behalten alle Hebel der Kalkulation.
 */
export function postenJeWahl(input: {
  ergebnis: RechnerErgebnis;
  anfrage: RechnerAnfrage;
  version: VersionsPreise;
  paketHebel: Record<string, HebelArt[]>;
  einPosten: boolean;
}): VersionsPreise {
  const { ergebnis, anfrage, version, paketHebel, einPosten } = input;
  const fuer = (cent: number | null, hebelNur: HebelArt[] | undefined) =>
    cent === null ? null : postenFuer({ zielCent: cent, ergebnis, anfrage, hebelNur, einPosten });
  const preisGleich = (original: number | null, summeCent: number) =>
    original === null ? null : inCent(original) === summeCent ? original : summeCent / 100;
  const paket = <T extends { slug: string; festpreis: number | null }>(p: T): T & { kvItems: KvPosten[] } => {
    const gebaut = fuer(ziel(p.festpreis), paketHebel[p.slug] ?? []);
    if (!gebaut) return { ...p, kvItems: [] };
    return { ...p, festpreis: preisGleich(p.festpreis, gebaut.summeCent), kvItems: gebaut.posten };
  };
  const tag = (t: Tagespreis): Tagespreis => {
    const gebaut = fuer(ziel(t.festpreis), undefined);
    return {
      ...t,
      festpreis: gebaut ? preisGleich(t.festpreis, gebaut.summeCent) : t.festpreis,
      kvItems: gebaut?.posten ?? [],
      paketpreise: t.paketpreise ? t.paketpreise.map(paket) : t.paketpreise,
    };
  };
  const haupt = fuer(version.priceCents, undefined);
  return {
    ...version,
    priceCents: haupt && version.priceCents !== null && version.priceCents !== haupt.summeCent ? haupt.summeCent : version.priceCents,
    kvItems: haupt?.posten ?? [],
    packagePrices: version.packagePrices.map(paket),
    dayPrices: version.dayPrices.map(tag),
  };
}

/** Stunden-KV: Menge ist die Zahl der Leute und Fahrzeuge, der Satz gilt je Stunde. */
export function stundenPosten(s: RechnerStunden): {
  posten: Array<KvPosten & { type: "helper" | "transporter" | "other" }>;
  angebot: StundenAngebot;
} {
  return {
    posten: [
      { type: "helper", description: "Helfer", quantity: s.helfer, unitRate: s.satzHelferEur },
      { type: "transporter", description: "Transporter", quantity: s.transporter, unitRate: s.satzTransporterEur },
      ...s.zusatzposten.map((z) => ({
        type: "other" as const,
        description: z.bezeichnung,
        quantity: 1,
        unitRate: z.betrag,
      })),
    ],
    angebot: {
      helfer: s.helfer,
      transporter: s.transporter,
      stundenGeschaetzt: s.stundenGeschaetzt,
      mindestStunden: s.mindestStunden,
      satzHelferEur: s.satzHelferEur,
      satzTransporterEur: s.satzTransporterEur,
      summeGeschaetztCent: inCent(s.summeGeschaetztEur),
      mindestbetragCent: inCent(s.mindestbetragEur),
      quelle: "version",
    },
  };
}

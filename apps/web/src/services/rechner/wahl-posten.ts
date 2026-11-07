/**
 * Posten je Kundenwahl und Stunden-Posten (Plan 5b, Entscheidung 6 und 7).
 * Der Preis kommt aus der Version. Der Kern fängt die Rundung, damit die
 * Posten auf den Cent genau den Preis der Wahl ergeben.
 */
import type { RechnerStunden, StundenAngebot, Tagespreis, VersionsPreise } from "@/lib/angebot-wahl";
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
    anfrage,
    festpreisIstEndpreis: true,
    ...(hebelNur === undefined ? {} : { hebelNur }),
    zusammenklappen: "kern_min",
  });
  return vorlage.posten[0]?.description ?? "";
}

function postenFuer(input: {
  zielCent: number;
  ergebnis: RechnerErgebnis;
  anfrage: RechnerAnfrage;
  hebelNur: HebelArt[] | undefined;
  einPosten: boolean;
}): KvPosten[] {
  if (input.einPosten) {
    return angleichen(
      [
        {
          description: sammeltext(input.ergebnis, input.anfrage, input.hebelNur),
          quantity: 1,
          unitRate: input.zielCent / 100,
        },
      ],
      input.zielCent
    );
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
  if (gebaut.kern <= 0) return gebaut.posten;
  return angleichen(gebaut.posten, input.zielCent);
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
    cent === null ? [] : postenFuer({ zielCent: cent, ergebnis, anfrage, hebelNur, einPosten });
  const paket = <T extends { slug: string; festpreis: number | null }>(p: T): T & { kvItems: KvPosten[] } => ({
    ...p,
    kvItems: fuer(ziel(p.festpreis), paketHebel[p.slug] ?? []),
  });
  const tag = (t: Tagespreis): Tagespreis => ({
    ...t,
    kvItems: fuer(ziel(t.festpreis), undefined),
    paketpreise: t.paketpreise ? t.paketpreise.map(paket) : t.paketpreise,
  });
  return {
    ...version,
    kvItems: fuer(version.priceCents, undefined),
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

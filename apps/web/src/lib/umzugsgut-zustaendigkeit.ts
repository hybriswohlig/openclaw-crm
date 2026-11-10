/**
 * Spalten Demontage und Montage der Umzugsgutliste im KV und in der AB
 * (Inhaber-Meldung 10.11., Viktoriia): wer je Möbelstück abbaut und aufbaut,
 * so wie die maßgebliche Kalkulation gerechnet hat. Rein, ohne Datenbank.
 *
 * Vorher kamen die Spalten nur aus `deal_inventory_items.dismantling_owner`
 * bzw. `assembly_owner`. Die stehen auf „none“, solange niemand je Stück etwas
 * eingetragen hat; zerlegt der Rechner nach seiner Katalogregel, stand im KV
 * bei jedem Möbel „Nicht vorgesehen“, obwohl Preis und „Unsere Leistungen“ die
 * Montage enthielten.
 *
 * Regel je Zeile (Name wie im Inventar, Schlüssel `positionSchluessel`):
 * 1. Trägt die Anfrage der Version für diese Zeile `abbau`/`aufbau` (CRM-Wahl je
 *    Position, Schalter `montage_je_position`), gilt genau das; eine fehlende
 *    Seite ist „none“ (so liest es der Rechner).
 * 2. Sonst: hat der Rechner die Position zerlegt (Katalogregel), baut die Firma
 *    ab und auf.
 * Eine Firma-Seite aus 1. oder 2. wird gedeckelt, wenn die Montage abgewählt ist
 * (Hebel ✕ `hebel_aus`, „ohne Montage“): dann wie „Unsere Leistungen“ (Kunde bzw.
 * nicht vorgesehen), nie „Koke“ ohne Preis.
 * 3. Sonst „none“ („Nicht vorgesehen“).
 * Ohne Ergebnis einer Kalkulation bleibt es bei den Angaben im Lead.
 */
import type { RechnerErgebnis } from "@/services/rechner/client";
import type { RechnerAnfrage } from "@/services/rechner/eingabe";
import { positionSchluessel } from "./kalkulation-versionen";
import { hebelAusEnthaelt } from "@/services/rechner/kv-posten";

export type Zustaendig = "company" | "customer" | "none";

export interface UmzugsgutZeile {
  name: string;
  dismantlingOwner: unknown;
  assemblyOwner: unknown;
}

export interface MassgeblicheKalkulation {
  anfrage: RechnerAnfrage | null;
  ergebnis: Pick<RechnerErgebnis, "positionen"> | null;
}

/** Wer laut „Unsere Leistungen“ (documentDetails.services) die Seite insgesamt übernimmt. */
export interface LeistungsSeiten {
  dismantling?: { owner?: unknown } | null;
  assembly?: { owner?: unknown } | null;
}

function istZustaendig(w: unknown): w is Zustaendig {
  return w === "company" || w === "customer" || w === "none";
}

function ausLead(w: unknown): Zustaendig {
  return w === "company" || w === "customer" ? w : "none";
}

export function umzugsgutZustaendigkeit(
  zeilen: readonly UmzugsgutZeile[],
  kalkulation: MassgeblicheKalkulation | null,
  leistungen?: LeistungsSeiten | null
): Array<{ dismantling: Zustaendig; assembly: Zustaendig }> {
  const positionen = kalkulation?.ergebnis?.positionen;
  if (!kalkulation || !Array.isArray(positionen)) {
    return zeilen.map((z) => ({ dismantling: ausLead(z.dismantlingOwner), assembly: ausLead(z.assemblyOwner) }));
  }

  const jePosition = kalkulation.anfrage?.montage_je_position === "1";
  const explizit = new Map<string, { abbau: Zustaendig; aufbau: Zustaendig }>();
  const freitext = kalkulation.anfrage?.positionen_freitext;
  if (jePosition && Array.isArray(freitext)) {
    for (const f of freitext) {
      const name = typeof f.name === "string" ? f.name : "";
      const abbau = istZustaendig(f.abbau) ? f.abbau : undefined;
      const aufbau = istZustaendig(f.aufbau) ? f.aufbau : undefined;
      if (!name.trim() || (abbau === undefined && aufbau === undefined)) continue;
      explizit.set(positionSchluessel(name), { abbau: abbau ?? "none", aufbau: aufbau ?? "none" });
    }
  }

  const zerlegt = new Set<string>();
  for (const p of positionen) if (p.zerlegt === true && typeof p.name === "string") zerlegt.add(positionSchluessel(p.name));

  // Montage abgewählt (Review I2): Hebel ✕ (hebel_aus) bzw. „ohne Montage“ in den Leistungen. Dann nie
  // „Koke“ ohne Preis: eine Firma-Seite wird so, wie die Leistungen sie nennen (Kunde bzw. nicht vorgesehen).
  const hebelAus = kalkulation.anfrage ? hebelAusEnthaelt(kalkulation.anfrage, "montage") : false;
  const deckeln = (wert: Zustaendig, s: { owner?: unknown } | null | undefined): Zustaendig => {
    if (wert !== "company") return wert;
    if (hebelAus) return "customer";
    if (s?.owner === "customer") return "customer";
    if (s?.owner === "none") return "none";
    return "company";
  };

  return zeilen.map((z) => {
    const key = positionSchluessel(z.name);
    const e = explizit.get(key);
    if (e) return { dismantling: deckeln(e.abbau, leistungen?.dismantling), assembly: deckeln(e.aufbau, leistungen?.assembly) };
    if (zerlegt.has(key)) return { dismantling: deckeln("company", leistungen?.dismantling), assembly: deckeln("company", leistungen?.assembly) };
    // Ohne Schalter (alte Versionen) las der Rechner keine Wahl je Stück: der Kunde
    // aus dem Lead bleibt sichtbar, eine Firma ohne Zerlegen nicht.
    if (!jePosition) {
      return {
        dismantling: ausLead(z.dismantlingOwner) === "customer" ? "customer" : "none",
        assembly: ausLead(z.assemblyOwner) === "customer" ? "customer" : "none",
      };
    }
    return { dismantling: "none", assembly: "none" };
  });
}

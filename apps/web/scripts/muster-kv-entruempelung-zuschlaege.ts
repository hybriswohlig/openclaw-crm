/**
 * Muster-KV einer Entrümpelung mit allen neuen Positionen.
 * Schreibt nur eine PDF. Verschickt nichts und setzt notifyCustomer nicht.
 *
 *   pnpm exec tsx scripts/muster-kv-entruempelung-zuschlaege.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { buildDocumentModel, KOTTKE_RESTBETRAG_EINSATZ, renderPdf } from "@openclaw-crm/document-templates";
import type { RechnerErgebnis } from "@/services/rechner/client";
import { kvBausteine } from "@/services/rechner/kv-posten";

const festpreis = 1630;
const ergebnis = {
  preis: {
    festpreis,
    posten: [
      { key: "verkauf.entsorgung", bezeichnung: "Entsorgung", menge: 11.522, einheit: "m³", satz: 65, betrag: 748.93 },
      { key: "verkauf.arbeitsstunden", bezeichnung: "Arbeitsstunden", menge: 5, einheit: "Std", satz: 35, betrag: 175 },
    ],
  },
  zeiten: { demontage: 108, montage: 0, packen: 0 },
  team: { groesse: 3 },
  positionen: [
    { name: "Boxspringbett", menge: 1, volumenCbm: 2, zerlegt: true },
    { name: "Esstisch", menge: 1, volumenCbm: 1, zerlegt: true },
    { name: "Schreibtisch", menge: 1, volumenCbm: 0.7, zerlegt: true },
  ],
  fahrzeugoptionen: [{ id: "lang@station", name: "Sprinter lang L3H2", fahrten: 1, km: 80, fahrtMin: 75, teamgroesse: 3 }],
  empfehlungOptionId: "lang@station",
} as RechnerErgebnis;

const kv = kvBausteine({
  festpreis,
  ergebnis,
  anfrage: {
    auftragsart: "entruempelung",
    von_adresse: "Hauptstr. 5, 72202 Nagold",
    von_etage: "2",
    von_aufzug: "keiner",
    von_tragestrecke: "12",
    z_sondermuell: "on",
    z_sondermuell_stueck: "2",
    z_elektro: "on",
    z_elektro_stueck: "3",
    z_keller: "on",
    z_dachboden: "on",
    z_garage: "on",
    z_trageweg: "on",
    z_besenrein: "on",
    z_besenrein_qm: "20",
    z_boden: "on",
    z_boden_qm: "15",
    z_wertanrechnung: "on",
    z_wertanrechnung_betrag: "50",
  },
});

const erwartet = [
  "Räumung & Abtransport",
  "Fachgerechte Entsorgung",
  "Demontage",
  "Sondermüll und Problemstoffe",
  "Elektrogeräte, weiße Ware und Bildschirme",
  "Zuschlag Keller, Dachboden und Garage",
  "Zuschlag Trageweg, 2 Stockwerke ohne Aufzug",
  "Besenreine Übergabe und Endreinigung",
  "Entfernen von Bodenbelägen und Tapeten",
  "Wertanrechnung für verwertbare Gegenstände",
];
for (const nadel of erwartet) {
  if (!kv.posten.some((p) => p.description.includes(nadel))) {
    throw new Error(`Position fehlt: ${nadel}`);
  }
}
for (const p of kv.posten) {
  if (/[–—]/.test(p.description)) throw new Error(`Gedankenstrich im Kundentext: ${p.description}`);
}
if (kv.summe <= 0) throw new Error("Summe ist nicht positiv");
const summeCent = kv.posten.reduce((s, p) => s + Math.round(p.unitRate * 100) * p.quantity, 0);
if (summeCent !== Math.round(kv.summe * 100)) throw new Error(`Posten ${summeCent} ergeben nicht ${kv.summe}`);

const model = buildDocumentModel({
  kind: "KV",
  deal: {
    firma: "kottke",
    customerName: "Muster Entrümpelung",
    customerAddress: "Hauptstr. 5, 72202 Nagold",
    fromAddress: "Hauptstr. 5, 72202 Nagold",
    serviceDate: "2026-12-02",
    documentDate: "2026-11-24",
  },
  quotation: {
    isVariable: false,
    fixedPrice: kv.summe.toFixed(2),
    lineItems: kv.posten.map((p) => ({
      type: "other",
      description: p.description,
      quantity: p.quantity,
      unitRate: p.unitRate.toFixed(2),
    })),
    depositRequiredCents: 40000,
    paymentMethodPreference: "bank_transfer",
    validUntil: "2026-12-01",
    summary: "Entrümpelung mit Sondermüll, Elektrogeräten, Bereichen, Trageweg, Endreinigung, Boden und Wertanrechnung",
    serviceType: "clearance",
  },
  service: { showStandardInclusions: true },
});

const zahlung = model.paymentTerms ?? "";
if (!zahlung.includes(KOTTKE_RESTBETRAG_EINSATZ)) {
  throw new Error("Restbetrag steht nicht auf dem Einsatztag");
}
if (zahlung.includes("Umzugstag")) throw new Error("Entrümpelung nennt den Umzugstag");

async function main() {
  const pdf = await renderPdf(model);
  const ziel = "/opt/cursor/artifacts/muster-kv-entruempelung-zuschlaege.pdf";
  mkdirSync("/opt/cursor/artifacts", { recursive: true });
  writeFileSync(ziel, pdf);
  console.log(`${ziel} (${pdf.length} Bytes, Summe ${kv.summe.toFixed(2)} €)`);
  for (const p of kv.posten) console.log(`- ${p.quantity} × ${p.unitRate.toFixed(2)}  ${p.description}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

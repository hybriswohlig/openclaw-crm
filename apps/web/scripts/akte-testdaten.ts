/**
 * Lokale Testdaten für die Sichtprüfung der Akte (Plan 3, Task 10).
 *
 * Legt einen Workspace, den Nutzer Herr Testmann, zwei Betriebsgesellschaften
 * und vier Deals an:
 *   (a) Angebot, KV v2 gesendet, WhatsApp- und E-Mail-Gespräch, 3× geöffnet,
 *       offener Nachfass-Entwurf; für die Kalkulationsseite (Plan 4, Task 8)
 *       14 Fotos am WhatsApp-Gespräch, Inventar mit Treffern und Abbau/Aufbau,
 *       Versionen v1 und v2 gesperrt (v2 gesendet) und ein Entwurf v3 mit
 *       einer Zeitposten- und einer Marge-Anpassung, alle in den echten Formen
 *       (KvPosten, kosten.posten mit key/formel, personalStunden, rundungEur,
 *       margeVorschlag.gruende, mietstation.adresse, montageJePosition)
 *   (b) Neue Anfrage ohne Gespräch
 *   (c) Durchgeführt, Rechnung, Rest 1.980 €, offene Meldung „bezahlt“
 *   (d) Verloren
 * Plan 5b (Task U1): Kottke hat die Schalter „Angebot aus Kalkulation“ und
 * „Tagespreise“ an und vier Pakete mit Hebeln (Basis nur Kern, Komfort
 * Halteverbot und Montage, Premium alle vier, Einzeltransport ohne).
 *
 * Erfundene Namen. Telefonnummern nur im Bereich +49 1550 000xxx.
 * E-Mail nur @example.com. Kanalzeilen ohne Zugangsdaten: Kanäle, Push und
 * Crons bleiben aus.
 *
 * Bricht ab, wenn die Authority von DATABASE_URL ein Komma oder mehr
 * als ein @ enthält, oder wenn postgres.js einen Host sieht, der nicht
 * 127.0.0.1 oder localhost ist.
 * Keine .env-Datei anlegen und keine Datei mit echten Zugangsdaten schreiben.
 * DATABASE_URL nur in der Shell setzen.
 *
 * Wegwerf-Datenbank im Scratchpad (Port 54331, nur TCP auf 127.0.0.1).
 * initdb-Nutzer ist postgres, derselbe Name wie in DATABASE_URL:
 *
 *   initdb -D /private/tmp/claude-501/m1c-t10-pg --username=postgres --auth=trust
 *   pg_ctl -D /private/tmp/claude-501/m1c-t10-pg -l /tmp/m1c-t10-pg.log \
 *     -o "-p 54331 -k /tmp -c listen_addresses=127.0.0.1" start
 *   createdb -h 127.0.0.1 -p 54331 -U postgres akte_testdaten
 *
 * Schema aus apps/web. drizzle-kit push legt auf einer leeren Datenbank
 * das ganze Schema an, einschließlich allem aus den Migrationen 0053 bis
 * 0058. Nichts davon muss von Hand nachgezogen werden. drizzle-kit liest
 * DATABASE_URL aus der Shell; keine .env mit echten Zugangsdaten im
 * Worktree lassen:
 *
 *   cd apps/web
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:54331/akte_testdaten \
 *     npx drizzle-kit push --force
 *
 * Danach dieses Skript:
 *
 *   cd apps/web
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:54331/akte_testdaten \
 *     npx tsx scripts/akte-testdaten.ts
 *
 * Sichtprüfung: `next dev` aus diesem Worktree, DATABASE_URL und
 * BETTER_AUTH_SECRET nur in der Shell. Anmeldung mit dem angelegten Nutzer
 * (siehe Konsolenausgabe). Kanäle, Push und Crons bleiben aus.
 *
 * Firma von (a) ist Kottke Testumzüge, damit der Nachfass-Schalter dort
 * nicht beendet ist. (b) und (c) bleiben bei Beispiel Transporte (fremde
 * Firma). (d) ist der verlorene Fall.
 */

import { deflateSync } from "node:zlib";
import postgres from "postgres";

const EMAIL = "herr.testmann@example.com";
const PASSWORD = "Testdaten-Lokal-1";
const NAME = "Herr Testmann";

function abbruch(meldung: string): never {
  console.error(meldung);
  process.exit(1);
}

/** Teil zwischen "://" und dem ersten "/" oder "?". */
function autoritaet(raw: string): string | null {
  const marke = "://";
  const start = raw.indexOf(marke);
  if (start < 0) return null;
  const rest = raw.slice(start + marke.length);
  const ende = rest.search(/[/?]/);
  return ende === -1 ? rest : rest.slice(0, ende);
}

function datenbankHosts(): string[] {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    abbruch("Abbruch: DATABASE_URL fehlt. Nur eine lokale Wegwerf-Datenbank ist erlaubt.");
  }
  const teil = autoritaet(raw);
  if (teil === null) {
    abbruch("Abbruch: DATABASE_URL ist keine gültige URL.");
  }
  const atZeichen = teil.split("@").length - 1;
  if (teil.includes(",") || atZeichen > 1) {
    abbruch(
      "Abbruch: DATABASE_URL nennt mehrere Hosts oder mehrere @. Nur 127.0.0.1 oder localhost ist erlaubt."
    );
  }

  let client: postgres.Sql | undefined;
  let hosts: string[] = [];
  let ungueltig = false;
  try {
    client = postgres(raw);
    hosts = client.options.host;
  } catch {
    ungueltig = true;
  } finally {
    if (client) void client.end({ timeout: 0 });
  }
  if (ungueltig) {
    abbruch("Abbruch: DATABASE_URL ist keine gültige URL.");
  }
  const fremd = hosts.filter((host) => host !== "127.0.0.1" && host !== "localhost");
  if (hosts.length === 0 || fremd.length > 0) {
    abbruch(
      `Abbruch: DATABASE_URL zeigt auf ${hosts.join(", ") || "keinen Host"}, nicht auf 127.0.0.1 oder localhost.`
    );
  }
  return hosts;
}

datenbankHosts();

const STUFEN: Record<string, { titel: string; kategorie: string; endstufe: boolean }> = {
  Inquiry: { titel: "Neue Anfrage", kategorie: "open_new", endstufe: false },
  Contacted: { titel: "In Kontakt", kategorie: "open_engaged", endstufe: false },
  "Information gathered": { titel: "Informationen da", kategorie: "open_engaged", endstufe: false },
  Quoted: { titel: "Angebot", kategorie: "quoted", endstufe: false },
  Planned: { titel: "Geplant", kategorie: "booked", endstufe: false },
  Done: { titel: "Durchgeführt", kategorie: "done_unpaid", endstufe: true },
  Paid: { titel: "Bezahlt", kategorie: "paid", endstufe: true },
  Lost: { titel: "Verloren", kategorie: "lost", endstufe: true },
};

function adresse(line1: string, city: string, postcode: string) {
  return { line1, line2: "", city, state: "", postcode, country: "DE" };
}

/* ── Fotos: kleine PNGs ohne Bibliothek (zwei Töne, senkrechter Verlauf) ── */

const CRC_TABELLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABELLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(typ: string, daten: Uint8Array): Buffer {
  const laenge = Buffer.alloc(4);
  laenge.writeUInt32BE(daten.length);
  const inhalt = Buffer.concat([Buffer.from(typ, "latin1"), Buffer.from(daten)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(inhalt));
  return Buffer.concat([laenge, inhalt, crc]);
}

function hexFarbe(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** PNG (RGB, 8 Bit) mit Verlauf von `oben` nach `unten`, dazu ein hellerer Block als „Möbel“. */
function pngBild(breite: number, hoehe: number, oben: string, unten: string): Buffer {
  const a = hexFarbe(oben);
  const b = hexFarbe(unten);
  const zeilen = Buffer.alloc((breite * 3 + 1) * hoehe);
  let p = 0;
  for (let y = 0; y < hoehe; y++) {
    zeilen[p++] = 0;
    const t = y / Math.max(1, hoehe - 1);
    for (let x = 0; x < breite; x++) {
      const block = x > breite * 0.18 && x < breite * 0.82 && y > hoehe * 0.42;
      for (let k = 0; k < 3; k++) {
        const wert = a[k]! + (b[k]! - a[k]!) * t;
        zeilen[p++] = Math.max(0, Math.min(255, Math.round(block ? wert * 0.82 : wert)));
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(breite, 0);
  ihdr.writeUInt32BE(hoehe, 4);
  ihdr[8] = 8; // Bittiefe
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(zeilen)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

const FOTO_TOENE: Array<[string, string]> = [
  ["#e7e9ed", "#cfd3da"], ["#e3e6ea", "#c9ced6"], ["#e8e4e0", "#d1c9c2"], ["#e5e8ec", "#c8cdd5"],
  ["#e9e7e4", "#d3cfca"], ["#e2e6ea", "#c4cad2"], ["#e6e8eb", "#cdd1d8"], ["#e8e9ec", "#cfd2d9"],
  ["#e4e7eb", "#c7ccd4"], ["#e7e5e2", "#d0cbc5"], ["#e5e8ec", "#c9ced6"], ["#e8e7e5", "#d2cfcb"],
  ["#e3e6ea", "#c5cad2"], ["#e6e8eb", "#ccd0d7"],
];

/* ── Rechner-Ergebnis der Familie Weber in den echten Formen ──────────────── */

interface Posten {
  key: string;
  bezeichnung: string;
  menge: number | null;
  einheit: string | null;
  satz: number | null;
  betrag: number;
  formel: string | null;
  quelle: string;
  hebel?: "montage" | "halteverbot" | "einpacken" | "kueche";
}

const MARGE_VORSCHLAG = {
  prozent: 37,
  gruende: [
    { text: "Basis Kottke", punkte: 40 },
    { text: "Quelle Kleinanzeigen", punkte: -3 },
    { text: "Freitag, keine Eile, kein Monatsende", punkte: 0 },
  ],
};

const eur2 = (x: number) => Math.round(x * 100) / 100;

/** Kette aus den Posten: Zwischensumme, Gemeinkosten 35 %, Versicherung 20 €, Preis bei Marge, Rundung 10 €. */
function kette(posten: Posten[], margeProzent: number) {
  const zwischensumme = eur2(posten.reduce((s, p) => s + p.betrag, 0));
  const gemeinkosten = eur2(zwischensumme * 0.35);
  const versicherung = 20;
  const selbstkosten = eur2(zwischensumme + gemeinkosten + versicherung);
  const festpreisRoh = eur2(selbstkosten / (1 - margeProzent / 100));
  const festpreis = Math.ceil(festpreisRoh / 10) * 10;
  const alle: Posten[] = [
    ...posten,
    { key: "gemeinkosten", bezeichnung: "Gemeinkosten und Risiko", menge: zwischensumme, einheit: "€", satz: 0.35, betrag: gemeinkosten, formel: `35 % von ${zwischensumme.toLocaleString("de-DE")} €`, quelle: "tarif" },
    { key: "versicherung", bezeichnung: "Transportversicherung pauschal", menge: null, einheit: null, satz: null, betrag: versicherung, formel: null, quelle: "tarif" },
  ];
  return { posten: alle, zwischensumme, gemeinkosten, selbstkosten, festpreisRoh, festpreis, margeEur: eur2(festpreis - selbstkosten) };
}

interface WeberStand {
  volumen: number;
  /** Personenminuten Arbeit (Laden, Tragen, Montage) ohne Puffer */
  arbeitPm: number;
  zeitpostenPm: number;
  halteverbotSeiten: 1 | 2;
  /** Montage-Hebel im KV (Wandschrank, Bett mit Abbau/Aufbau durch die Firma) */
  montage: boolean;
  margeProzent: number;
  margeQuelle: "vorschlag" | "anfrage";
}

/** Rechner-Ergebnis mit allen Feldern, die die Kalkulationsseite liest. */
function weberErgebnis(s: WeberStand) {
  const pufferProzent = 10;
  const arbeitMitPosten = s.arbeitPm + s.zeitpostenPm;
  const personenMin = Math.round(arbeitMitPosten * (1 + pufferProzent / 100));
  const personenH = Math.round((personenMin / 60) * 10) / 10;
  const jePerson = Math.round((personenH / 3) * 10) / 10;
  const posten: Posten[] = [
    { key: "personal.arbeit", bezeichnung: "Arbeit", menge: personenH, einheit: "Personenstunden", satz: 20, betrag: eur2(personenH * 20), formel: `3 × ${jePerson.toLocaleString("de-DE")} h × 20 €`, quelle: "tarif" },
    { key: "personal.fahrt", bezeichnung: "Fahrt", menge: 3.6, einheit: "h", satz: 15, betrag: 54, formel: "3 × 1,2 h × 15 €", quelle: "tarif" },
    { key: "fahrzeug.sprinter_l.miete", bezeichnung: "Sprinter L · Sixt Feuerbach · 17. bis 23.11.", menge: 1, einheit: "Anteil", satz: 150, betrag: 150, formel: "Wochenmiete 450 € ÷ 3 Umzüge", quelle: "tarif" },
    { key: "fahrzeug.sprinter_l.kraftstoff", bezeichnung: "Kraftstoff 48 km", menge: 48, einheit: "km", satz: 0.19, betrag: 9, formel: "48 km × 0,19 €", quelle: "tarif" },
    { key: "fahrzeug.sprinter_l.mehrkm", bezeichnung: "Mehrkilometer · 48 von 310 km Rest inklusive", menge: 0, einheit: "km", satz: 0.25, betrag: 0, formel: null, quelle: "tarif" },
    { key: "halteverbot", bezeichnung: s.halteverbotSeiten === 2 ? "Halteverbot beidseitig" : "Halteverbot beim Beladen", menge: s.halteverbotSeiten, einheit: "Seiten", satz: 130, betrag: 130 * s.halteverbotSeiten, formel: `${s.halteverbotSeiten} × 130 €`, quelle: "tarif", hebel: "halteverbot" },
    { key: "material.folie", bezeichnung: "Folie", menge: 1, einheit: "Pauschale", satz: 30, betrag: 30, formel: null, quelle: "tarif" },
    { key: "material.decken", bezeichnung: "Decken und Gurte", menge: s.volumen, einheit: "m³", satz: 0.7, betrag: eur2(s.volumen * 0.7), formel: `${s.volumen} m³ × 0,70 €`, quelle: "tarif" },
    { key: "material.kartons", bezeichnung: "60 Umzugskartons", menge: 60, einheit: "Stück", satz: 2.5, betrag: 150, formel: "60 × 2,50 €", quelle: "tarif", hebel: "einpacken" },
    { key: "anfahrtsgeld", bezeichnung: "Mitarbeiter-Anfahrt", menge: 30, einheit: "km", satz: 0.3, betrag: 9, formel: "eigener PKW · 30 km × 0,30 €", quelle: "tarif" },
  ];
  const k = kette(posten, s.margeProzent);
  const listenpreis = Math.ceil((k.selbstkosten / 0.42) / 10) * 10;
  return {
    ergebnis: {
      montageJePosition: true,
      volumen: { nettoCbm: s.volumen, ladeCbm: eur2(s.volumen * 1.1), gewichtKg: s.volumen * 110 },
      team: { groesse: 3 },
      tarif: { id: "tarif-kottke-test", version: 1, marke: "kottke" as const },
      kosten: {
        selbstkosten: k.selbstkosten,
        personenH,
        personalStunden: { arbeitPm: arbeitMitPosten, fahrerPm: 0, fahrzeitPm: 216, pufferProzent, personenH },
        posten: k.posten,
      },
      preis: {
        festpreis: k.festpreis,
        festpreisRoh: k.festpreisRoh,
        mindestpreis: Math.ceil(k.selbstkosten / 0.7 / 10) * 10,
        selbstkosten: k.selbstkosten,
        margeProzent: s.margeProzent,
        margeWirksamProzent: s.margeProzent,
        margeQuelle: s.margeQuelle,
        margeEur: k.margeEur,
        rundungEur: 10,
        listenpreis,
        festpreisBeiMindestmarge: Math.ceil(k.selbstkosten / 0.7 / 10) * 10,
        margeVorschlag: MARGE_VORSCHLAG,
        posten: [
          { key: "verkauf.kern", bezeichnung: "Umzugsteam 3 Personen und Sprinter L", menge: 1, einheit: "Pauschale", satz: k.festpreis - 150 * s.halteverbotSeiten - 170 - (s.montage ? 60 : 0), betrag: k.festpreis - 150 * s.halteverbotSeiten - 170 - (s.montage ? 60 : 0), formel: null, quelle: "tarif" },
          { key: "verkauf.halteverbot", bezeichnung: "Halteverbot", menge: s.halteverbotSeiten, einheit: "Seiten", satz: 150, betrag: 150 * s.halteverbotSeiten, formel: `${s.halteverbotSeiten} × 150 €`, quelle: "tarif", hebel: "halteverbot" as const },
          ...(s.montage
            ? [{ key: "verkauf.montage", bezeichnung: "Demontage & Montage", menge: 1.5, einheit: "h", satz: 35, betrag: 60, formel: "1,5 h × 35 €, aufgerundet", quelle: "tarif", hebel: "montage" as const }]
            : []),
          { key: "verkauf.kartons", bezeichnung: "60 Umzugskartons", menge: 60, einheit: "Stück", satz: 2.8333, betrag: 170, formel: "aus 150 € Kosten", quelle: "tarif", hebel: "einpacken" as const },
        ],
      },
      margeVorschlag: MARGE_VORSCHLAG,
      mietstation: {
        name: "Sixt Feuerbach",
        anbieter: "Sixt",
        adresse: "Beispielstraße 100, 70469 Stuttgart",
        quelle: "tarif",
        anfahrtKm: 9,
        anfahrtMin: 16,
        rueckfahrtKm: 18,
        rueckfahrtMin: 24,
      },
      stationsVergleich: [
        { name: "Sixt Feuerbach", festpreis: k.festpreis, selbstkosten: k.selbstkosten, gewaehlt: true, anfahrtMin: 16, rueckfahrtMin: 24, fahrzeug: "Sprinter L" },
        { name: "Sixt Vaihingen", festpreis: k.festpreis + 20, selbstkosten: eur2(k.selbstkosten + 14), gewaehlt: false, anfahrtMin: 24, rueckfahrtMin: 31, fahrzeug: "Sprinter L" },
        { name: "Hertz Esslingen", festpreis: k.festpreis + 30, selbstkosten: eur2(k.selbstkosten + 19), gewaehlt: false, anfahrtMin: 32, rueckfahrtMin: 8, fahrzeug: "Sprinter L" },
        { name: "Buchbinder Ludwigsburg", festpreis: k.festpreis + 60, selbstkosten: eur2(k.selbstkosten + 38), gewaehlt: false, anfahrtMin: 38, rueckfahrtMin: 44, fahrzeug: "Sprinter L" },
      ],
      positionen: [
        { name: "Wandschrank", menge: 1, volumenCbm: 3.2, zerlegt: true, demontageQuelle: "wunsch" as const },
        { name: "Sofa", menge: 1, volumenCbm: 2.1, zerlegt: false, demontageQuelle: "nicht_zerlegbar" as const },
        { name: "Bett", menge: 1, volumenCbm: 1.8, zerlegt: true, demontageQuelle: "wunsch" as const },
        { name: "Küche", menge: 1, volumenCbm: 4.5, zerlegt: true, demontageQuelle: "keine_regel" as const, ungeprueft: true },
        { name: "Esstisch", menge: 1, volumenCbm: 1.2 },
        { name: "Stuhl", menge: 6, volumenCbm: 0.3 },
        { name: "Kühlschrank", menge: 1, volumenCbm: 1.1 },
        { name: "Waschmaschine", menge: 1, volumenCbm: 0.6 },
        { name: "Regal", menge: 3, volumenCbm: 0.9 },
        { name: "Kommode", menge: 1, volumenCbm: 0.8 },
        { name: "Schreibtisch", menge: 1, volumenCbm: 1 },
        { name: "Fernseher", menge: 1, volumenCbm: 0.2 },
        { name: "Umzugskarton", menge: 60, volumenCbm: 0.07 },
      ],
      zuordnungFreitext: { nichtZugeordnet: ["Küche"] },
      fahrzeugoptionen: [
        { id: "sprinter_l", name: "Sprinter L", fahrten: 2, km: 48, fahrtMin: 72, teamgroesse: 3, uhrzeitMin: 0, auslastung: 0.95 },
        { id: "lkw_7_5", name: "LKW 7,5 t", fahrten: 1, km: 48, fahrtMin: 80, teamgroesse: 3, uhrzeitMin: 0, auslastung: 0.6 },
      ],
      empfehlungOptionId: "sprinter_l",
      zeiten: { fahrtMin: 72, uhrzeitMin: 0, einsatztage: 1, demontage: 45, montage: 45, packen: 0, zeitpostenPm: s.zeitpostenPm },
      hinweise: [] as Array<{ typ: string; text: string }>,
      annahmen: [] as string[],
      fahrzeitHinweis: null,
      schaetzung: null,
    },
    k,
  };
}

async function main(): Promise<void> {
  const { randomUUID } = await import("node:crypto");
  const { and, eq } = await import("drizzle-orm");
  const { hashPassword } = await import("better-auth/crypto");
  const { db } = await import("@/db");
  const { users, accounts } = await import("@/db/schema/auth");
  const { workspaces, workspaceMembers } = await import("@/db/schema/workspace");
  const { objects, attributes, statuses, selectOptions } = await import("@/db/schema/objects");
  const { userSettings } = await import("@/db/schema/user-settings");
  const { dealCalculationVersions } = await import("@/db/schema/deal-calculation-versions");
  const { quotations } = await import("@/db/schema/quotations");
  const { customerStatusLinks, offerPackages, operatingCompanyPortalSettings } = await import("@/db/schema/customer-portal");
  const { agentDrafts } = await import("@/db/schema/agent");
  const {
    channelAccounts,
    inboxContacts,
    inboxConversations,
    inboxMessageAttachments,
    inboxMessages,
  } = await import("@/db/schema/inbox");
  const { dealInventoryItems } = await import("@/db/schema/inventory");
  const { companySettings } = await import("@/db/schema/company-settings");
  const { seedWorkspaceObjects } = await import("@/services/workspace");
  const { createRecord } = await import("@/services/records");
  const { upsertQuotation } = await import("@/services/quotations");
  const { createDealDocument } = await import("@/services/deal-documents");
  const { createPayment } = await import("@/services/financial");
  const { emitEvent } = await import("@/services/activity-events");
  const { ensureCustomerStatusLink } = await import("@/services/customer-portal-data");
  const { ladeZahlungsmeldungen } = await import("@/services/zahlungsmeldungen");
  const { aktualisiereWartet } = await import("@/services/wartet");

  const [vorhanden] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
  if (vorhanden) {
    throw new Error("In der Datenbank liegt schon ein Workspace. Nur eine leere Wegwerf-Datenbank verwenden.");
  }

  const [workspace] = await db
    .insert(workspaces)
    .values({ name: "Testdaten Akte", slug: "testdaten-akte", settings: {} })
    .returning();
  if (!workspace) throw new Error("Workspace wurde nicht angelegt.");
  await seedWorkspaceObjects(workspace.id);

  const stufenZeilen = await db
    .select({ id: statuses.id, title: statuses.title })
    .from(statuses)
    .innerJoin(attributes, eq(attributes.id, statuses.attributeId))
    .innerJoin(objects, eq(objects.id, attributes.objectId))
    .where(and(eq(objects.workspaceId, workspace.id), eq(objects.slug, "deals"), eq(attributes.slug, "stage")));
  for (const zeile of stufenZeilen) {
    const ziel = STUFEN[zeile.title];
    if (!ziel) continue;
    await db
      .update(statuses)
      .set({
        title: ziel.titel,
        stageCategory: ziel.kategorie,
        isTerminal: ziel.endstufe,
        isActive: true,
      })
      .where(eq(statuses.id, zeile.id));
  }

  const userId = randomUUID();
  await db.insert(users).values({
    id: userId,
    name: NAME,
    email: EMAIL,
    emailVerified: true,
    approvalStatus: "approved",
    isAppAdmin: true,
    role: "staff",
  });
  await db.insert(accounts).values({
    id: randomUUID(),
    accountId: userId,
    providerId: "credential",
    userId,
    password: await hashPassword(PASSWORD),
  });
  await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId, role: "admin" });
  await db.insert(userSettings).values({ userId, uiVersion: "neu", ansichten: {} });

  async function objektId(slug: string): Promise<string> {
    const [zeile] = await db
      .select({ id: objects.id })
      .from(objects)
      .where(and(eq(objects.workspaceId, workspace.id), eq(objects.slug, slug)))
      .limit(1);
    if (!zeile) throw new Error(`Objekt ${slug} fehlt.`);
    return zeile.id;
  }

  async function stufeId(titel: string): Promise<string> {
    const [zeile] = await db
      .select({ id: statuses.id })
      .from(statuses)
      .innerJoin(attributes, eq(attributes.id, statuses.attributeId))
      .innerJoin(objects, eq(objects.id, attributes.objectId))
      .where(
        and(
          eq(objects.workspaceId, workspace.id),
          eq(objects.slug, "deals"),
          eq(attributes.slug, "stage"),
          eq(statuses.title, titel)
        )
      )
      .limit(1);
    if (!zeile) throw new Error(`Stufe ${titel} fehlt.`);
    return zeile.id;
  }

  async function optionId(objekt: string, slug: string, titel: string): Promise<string> {
    const [zeile] = await db
      .select({ id: selectOptions.id })
      .from(selectOptions)
      .innerJoin(attributes, eq(attributes.id, selectOptions.attributeId))
      .where(and(eq(attributes.objectId, objekt), eq(attributes.slug, slug), eq(selectOptions.title, titel)))
      .limit(1);
    if (!zeile) throw new Error(`Option ${slug}/${titel} fehlt.`);
    return zeile.id;
  }

  async function datensatz(objekt: string, werte: Record<string, unknown>): Promise<string> {
    const zeile = await createRecord(objekt, werte, userId);
    if (!zeile) throw new Error("Datensatz wurde nicht angelegt.");
    return zeile.id;
  }

  /** Wie `datensatz`, lässt aber Felder weg, die das Objekt in diesem Seed nicht hat (mit Hinweis). */
  async function datensatzMitVorhandenen(objekt: string, werte: Record<string, unknown>): Promise<string> {
    const zeilen = await db.select({ slug: attributes.slug }).from(attributes).where(eq(attributes.objectId, objekt));
    const slugs = new Set(zeilen.map((z) => z.slug));
    const fehlend = Object.keys(werte).filter((k) => !slugs.has(k));
    if (fehlend.length > 0) console.warn(`Hinweis: Attribute fehlen im Seed, übersprungen: ${fehlend.join(", ")}`);
    return datensatz(objekt, Object.fromEntries(Object.entries(werte).filter(([k]) => slugs.has(k))));
  }

  const firmaObjekt = await objektId("operating_companies");
  const dealObjekt = await objektId("deals");
  const kottke = await datensatz(firmaObjekt, {
    name: "Kottke Testumzüge",
    legal_name: "Kottke Testumzüge",
    phone: "+49 1550 000101",
    whatsapp: "+49 1550 000101",
    email: "muster@example.com",
    street: "Beispielweg 1",
    postal_code: "70173",
    city: "Stuttgart",
    website: "https://muster.example.com",
  });
  const beispiel = await datensatz(firmaObjekt, {
    name: "Beispiel Transporte",
    legal_name: "Beispiel Transporte GmbH",
    phone: "+49 1550 000102",
    whatsapp: "+49 1550 000102",
    email: "transporte@example.com",
    street: "Probenstraße 2",
    postal_code: "73728",
    city: "Esslingen",
    website: "https://beispiel.example.com",
  });

  // Zeitposten-Bibliothek der Kottke-Firma (Chips unter „Arbeit“ auf der Kalkulationsseite).
  await db.insert(companySettings).values({
    operatingCompanyRecordId: kottke,
    workspaceId: workspace.id,
    zeitposten: [
      { id: "klavier", bezeichnung: "Klavier", minuten: 60 },
      { id: "waschmaschine", bezeichnung: "Waschmaschine", minuten: 20 },
      { id: "kueche-abbauen", bezeichnung: "Küche abbauen", minuten: 120 },
      { id: "langer-tragweg", bezeichnung: "langer Tragweg je 10 m", minuten: 15 },
    ],
    rechnerMarke: "kottke",
  });

  // Plan 5b (Task U1): Kottke mit beiden Firmen-Schaltern und Paketen samt Hebeln (F6),
  // Beispiel Transporte ohne Schalter. Domain bleibt unkonfiguriert (keine Umleitung).
  await db.insert(operatingCompanyPortalSettings).values([
    {
      workspaceId: workspace.id,
      operatingCompanyRecordId: kottke,
      signatureEnabled: true,
      angebotAusKalkulation: true,
      tagespreiseEnabled: true,
    },
    { workspaceId: workspace.id, operatingCompanyRecordId: beispiel },
  ]);
  await db.insert(offerPackages).values(
    (
      [
        ["basis", "Basis", [], 10, false],
        ["komfort", "Komfort", ["halteverbot", "montage"], 20, true],
        ["premium", "Premium", ["halteverbot", "montage", "einpacken", "kueche"], 30, false],
        ["einzeltransport", "Einzeltransport", [], 40, false],
      ] as const
    ).map(([slug, displayName, hebel, sortOrder, isRecommended]) => ({
      workspaceId: workspace.id,
      operatingCompanyRecordId: kottke,
      slug,
      displayName,
      hebel: [...hebel],
      sortOrder,
      isRecommended,
      includedItems: [],
    }))
  );

  const angebotStufe = await stufeId("Angebot");
  const anfrageStufe = await stufeId("Neue Anfrage");
  const durchgefuehrtStufe = await stufeId("Durchgeführt");
  const verlorenStufe = await stufeId("Verloren");
  const quelleWhatsapp = await optionId(dealObjekt, "source_channel", "WhatsApp");
  const quelleTelefon = await optionId(dealObjekt, "source_channel", "Telefon");
  const quelleEmpfehlung = await optionId(dealObjekt, "source_channel", "Empfehlung");
  const verlustZuTeuer = await optionId(dealObjekt, "loss_reason", "zu teuer");

  const weber = await datensatzMitVorhandenen(dealObjekt, {
    name: "Familie Weber",
    stage: angebotStufe,
    operating_company: kottke,
    source_channel: quelleWhatsapp,
    zimmer: 3,
    move_date: "2026-11-20",
    first_reply_at: new Date("2026-11-04T09:15:00+01:00"),
    move_from_address: adresse("Beispielweg 12", "Stuttgart-West", "70178"),
    move_to_address: adresse("Probenstraße 4", "Esslingen", "73728"),
    floors_from: 2,
    floors_to: 0,
  });
  // Tragwege, Halteverbot und Kartons stehen am Auftrag (ladeLeadDaten); fehlt das Objekt im Seed, bleiben sie Standard.
  try {
    const auftragObjekt = await objektId("auftraege");
    await datensatzMitVorhandenen(auftragObjekt, {
      deal: weber,
      walking_distance_from_m: 25,
      walking_distance_to_m: 10,
      parking_halteverbot_needed: true,
      parking_halteverbot_to: true,
      packing_service: true,
      boxes_needed: 60,
    });
  } catch (err) {
    console.warn(`Hinweis: kein Auftrag für Familie Weber (${err instanceof Error ? err.message : String(err)})`);
  }

  const pdf = Buffer.from("%PDF-1.1\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
  const pdfB64 = pdf.toString("base64");
  // Versionen, Angebot und KV-Dokument der Familie Weber folgen unten, nach Fotos und Inventar.

  const [waKonto] = await db
    .insert(channelAccounts)
    .values({
      workspaceId: workspace.id,
      operatingCompanyRecordId: kottke,
      channelType: "whatsapp",
      name: "Muster WhatsApp",
      address: "+491550000101",
      waDisplayPhoneNumber: "+49 1550 000101",
      waPhoneNumberId: "155000000101",
      credential: null,
      isActive: false,
    })
    .returning();
  const [mailKonto] = await db
    .insert(channelAccounts)
    .values({
      workspaceId: workspace.id,
      operatingCompanyRecordId: kottke,
      channelType: "email",
      name: "Muster Post",
      address: "anfragen@example.com",
      credential: null,
      isActive: false,
    })
    .returning();
  if (!waKonto || !mailKonto) throw new Error("Kanal wurde nicht angelegt.");

  const [kontakt] = await db
    .insert(inboxContacts)
    .values({
      workspaceId: workspace.id,
      displayName: "Familie Weber",
      email: "familie.weber@example.com",
      phone: "+491550000201",
      phoneCanonical: "+491550000201",
      emailCanonical: "familie.weber@example.com",
    })
    .returning();
  if (!kontakt) throw new Error("Kontakt wurde nicht angelegt.");

  const [waGespraech] = await db
    .insert(inboxConversations)
    .values({
      workspaceId: workspace.id,
      channelAccountId: waKonto.id,
      contactId: kontakt.id,
      externalThreadId: "+491550000201",
      status: "open",
      dealRecordId: weber,
      lastMessageAt: new Date("2026-11-06T08:40:00+01:00"),
      lastMessagePreview: "Guten Tag, anbei der Kostenvoranschlag.",
      unreadCount: 0,
    })
    .returning();
  const [mailGespraech] = await db
    .insert(inboxConversations)
    .values({
      workspaceId: workspace.id,
      channelAccountId: mailKonto.id,
      contactId: kontakt.id,
      externalThreadId: "familie.weber@example.com",
      subject: "Umzug Stuttgart-West",
      status: "open",
      dealRecordId: weber,
      lastMessageAt: new Date("2026-11-05T15:10:00+01:00"),
      lastMessagePreview: "Können Sie den Termin noch bestätigen?",
      unreadCount: 1,
    })
    .returning();
  if (!waGespraech || !mailGespraech) throw new Error("Gespräch wurde nicht angelegt.");

  const gesperrtAm = new Date("2026-11-04T11:00:00+01:00");
  const gesendetAm = new Date("2026-11-04T11:40:00+01:00");
  const nachrichten = await db.insert(inboxMessages).values([
    {
      workspaceId: workspace.id,
      conversationId: waGespraech.id,
      direction: "inbound",
      status: "received",
      fromAddress: "+491550000201",
      toAddress: "+491550000101",
      body: "Guten Tag, wir möchten von Stuttgart-West nach Esslingen ziehen. Drei Zimmer.",
      sentAt: new Date("2026-11-04T09:05:00+01:00"),
    },
    {
      workspaceId: workspace.id,
      conversationId: waGespraech.id,
      direction: "outbound",
      status: "sent",
      fromAddress: "+491550000101",
      toAddress: "+491550000201",
      body: "Guten Tag, anbei der Kostenvoranschlag.",
      sentAt: gesendetAm,
    },
    {
      workspaceId: workspace.id,
      conversationId: mailGespraech.id,
      direction: "inbound",
      status: "received",
      fromAddress: "familie.weber@example.com",
      toAddress: "anfragen@example.com",
      subject: "Umzug Stuttgart-West",
      body: "Können Sie den Termin noch bestätigen?",
      isRead: false,
      sentAt: new Date("2026-11-05T15:10:00+01:00"),
    },
  ]).returning({ id: inboxMessages.id });
  const waEingang = nachrichten[0];
  if (!waEingang) throw new Error("WhatsApp-Nachricht wurde nicht angelegt.");

  // 14 Fotos am WhatsApp-Eingang; die Seite zeigt die neuesten zuerst.
  const fotoIds: string[] = [];
  for (let i = 0; i < FOTO_TOENE.length; i++) {
    const [oben, unten] = FOTO_TOENE[i]!;
    const bytes = pngBild(320, 240, oben, unten);
    const [foto] = await db
      .insert(inboxMessageAttachments)
      .values({
        workspaceId: workspace.id,
        messageId: waEingang.id,
        conversationId: waGespraech.id,
        dealRecordId: weber,
        fileName: `foto-${i + 1}.png`,
        mimeType: "image/png",
        fileSize: bytes.length,
        fileContent: bytes.toString("base64"),
        createdAt: new Date(Date.parse("2026-11-04T09:06:00+01:00") + i * 60_000),
      })
      .returning({ id: inboxMessageAttachments.id });
    if (!foto) throw new Error("Foto wurde nicht angelegt.");
    fotoIds.push(foto.id);
  }
  /** Foto der n-ten Kachel (neueste zuerst). */
  const kachel = (n: number): string => {
    const id = fotoIds[fotoIds.length - n];
    if (!id) throw new Error(`Kachel ${n} fehlt.`);
    return id;
  };

  // Inventar: Treffer der Fotoanalyse mit Foto, Abbau/Aufbau je Position, Rest aus dem Chat.
  type Besitzer = "company" | "customer" | "none";
  const inventarZeile = (
    i: number,
    z: {
      name: string;
      kategorie: string;
      menge?: number;
      volumen: number;
      groesse: "klein" | "mittel" | "gross" | "sperrig";
      foto?: string;
      zerlegen?: boolean;
      abbau?: Besitzer;
      aufbau?: Besitzer;
    }
  ) => ({
    workspaceId: workspace.id,
    dealRecordId: weber,
    name: z.name,
    category: z.kategorie,
    quantity: z.menge ?? 1,
    sizeClass: z.groesse,
    heavyFlag: z.groesse === "sperrig",
    fragileFlag: false,
    disassemblyRequired: z.zerlegen ?? false,
    moveFlag: true,
    photoAttachmentId: z.foto ?? null,
    volumeCbmEstimate: String(z.volumen),
    confidence: "hoch" as const,
    source: z.foto ? ("foto" as const) : ("chat" as const),
    needsPhoto: false,
    dismantlingOwner: z.abbau ?? ("none" as const),
    assemblyOwner: z.aufbau ?? ("none" as const),
    sortOrder: i,
  });
  await db.insert(dealInventoryItems).values([
    inventarZeile(0, { name: "Wandschrank", kategorie: "Möbel", volumen: 3.2, groesse: "gross", foto: kachel(1), zerlegen: true, abbau: "company", aufbau: "company" }),
    inventarZeile(1, { name: "Sofa", kategorie: "Möbel", volumen: 2.1, groesse: "gross", foto: kachel(3) }),
    inventarZeile(2, { name: "Küche", kategorie: "Küche", volumen: 4.5, groesse: "sperrig", foto: kachel(6), zerlegen: true, abbau: "company" }),
    inventarZeile(3, { name: "Bett", kategorie: "Möbel", volumen: 1.8, groesse: "gross", foto: kachel(9), zerlegen: true, abbau: "company", aufbau: "company" }),
    inventarZeile(4, { name: "Esstisch", kategorie: "Möbel", volumen: 1.2, groesse: "gross" }),
    inventarZeile(5, { name: "Stuhl", kategorie: "Möbel", menge: 6, volumen: 0.3, groesse: "mittel" }),
    inventarZeile(6, { name: "Kühlschrank", kategorie: "Elektrogerät", volumen: 1.1, groesse: "gross" }),
    inventarZeile(7, { name: "Waschmaschine", kategorie: "Elektrogerät", volumen: 0.6, groesse: "gross" }),
    inventarZeile(8, { name: "Regal", kategorie: "Möbel", menge: 3, volumen: 0.9, groesse: "mittel" }),
    inventarZeile(9, { name: "Kommode", kategorie: "Möbel", volumen: 0.8, groesse: "mittel" }),
    inventarZeile(10, { name: "Schreibtisch", kategorie: "Möbel", volumen: 1, groesse: "gross" }),
    inventarZeile(11, { name: "Fernseher", kategorie: "Elektrogerät", volumen: 0.2, groesse: "klein" }),
    inventarZeile(12, { name: "Umzugskarton", kategorie: "Karton", menge: 60, volumen: 0.07, groesse: "klein" }),
  ]);

  // Versionen in den echten Formen; Anfrage und Grundlage aus den Lead-Daten wie im Versionen-Dienst.
  const { grundlageAus, kostenzeilenAus, anfrageMitUebersteuerungen } = await import("@/lib/kalkulation-versionen");
  const { rechnerAnfrageAus } = await import("@/services/rechner/eingabe");
  const { ladeLeadDaten } = await import("@/services/rechner/lead-daten");
  const { heuteBerlin } = await import("@/services/rechner/quelle");
  const lead = await ladeLeadDaten(workspace.id, weber);
  if (!lead) throw new Error("Lead-Daten der Familie Weber fehlen.");
  const basisAnfrage = rechnerAnfrageAus(lead);
  const heute = heuteBerlin();
  const autor = { userId, quelle: "mensch" as const };
  const margeGewaehlt = {
    id: randomUUID(),
    art: "marge" as const,
    key: "marge",
    rechnerwert: 37,
    wert: 38,
    grund: "Marge im Regler gewählt",
    autor,
    zeit: "2026-11-04T10:52:00+01:00",
    fotoRef: null,
  };
  const zeitpostenWandschrank = {
    id: randomUUID(),
    art: "zeitposten" as const,
    key: "frei.wandschrank",
    rechnerwert: null,
    wert: { bezeichnung: "Wandschrank, Demontage + Aufbau", minuten: 90 },
    grund: "3-türig, auf Foto 3, braucht Demontage und Aufbau, Rechner hatte 0",
    autor,
    zeit: "2026-11-05T10:48:00+01:00",
    fotoRef: kachel(1),
  };
  const standV1 = weberErgebnis({ volumen: 32, arbeitPm: 1000, zeitpostenPm: 0, halteverbotSeiten: 1, montage: false, margeProzent: 37, margeQuelle: "vorschlag" });
  const standV2 = weberErgebnis({ volumen: 38, arbeitPm: 1184, zeitpostenPm: 0, halteverbotSeiten: 2, montage: true, margeProzent: 38, margeQuelle: "anfrage" });
  const standV3 = weberErgebnis({ volumen: 38, arbeitPm: 1184, zeitpostenPm: 90, halteverbotSeiten: 2, montage: true, margeProzent: 38, margeQuelle: "anfrage" });
  const v1 = randomUUID();
  const v2 = randomUUID();
  const v3 = randomUUID();
  const versionsZeile = (o: {
    id: string;
    version: number;
    status: "entwurf" | "gesperrt";
    referenceDate: string;
    stand: ReturnType<typeof weberErgebnis>;
    overrides: Array<typeof margeGewaehlt | typeof zeitpostenWandschrank>;
    kvItems: Array<{ description: string; quantity: number; unitRate: number }>;
    gewaehltProzent: number | null;
    createdAt: Date;
    lockedAt?: Date;
    sentAt?: Date;
    sentVia?: string;
  }) => ({
    id: o.id,
    workspaceId: workspace.id,
    dealRecordId: weber,
    version: o.version,
    status: o.status,
    pricingMode: "fest" as const,
    referenceDate: o.referenceDate,
    inputs: grundlageAus(lead, o.stand.ergebnis, o.overrides),
    overrides: o.overrides,
    rechnerRequest: anfrageMitUebersteuerungen(basisAnfrage, o.overrides, { referenceDate: o.referenceDate }),
    rechnerResult: o.stand.ergebnis,
    error: null,
    costLines: kostenzeilenAus(o.stand.ergebnis, o.overrides),
    margin: { vorschlagProzent: MARGE_VORSCHLAG.prozent, gruende: MARGE_VORSCHLAG.gruende, gewaehltProzent: o.gewaehltProzent },
    priceCents: Math.round(o.stand.k.festpreis * 100),
    packagePrices: [],
    kvItems: o.kvItems,
    tariff: o.stand.ergebnis.tarif,
    createdBy: userId,
    createdAt: o.createdAt,
    updatedAt: o.lockedAt ?? o.createdAt,
    lockedAt: o.lockedAt ?? null,
    lockedBy: o.lockedAt ? userId : null,
    sentAt: o.sentAt ?? null,
    sentVia: o.sentVia ?? null,
  });
  const kernV1 = standV1.k.festpreis - 150 - 150;
  const kernV2 = standV2.k.festpreis - 300 - 60 - 170;
  await db.insert(dealCalculationVersions).values([
    versionsZeile({
      id: v1,
      version: 1,
      status: "gesperrt",
      referenceDate: "2026-11-03",
      stand: standV1,
      overrides: [],
      kvItems: [
        { description: "Umzugsteam 3 Personen und Sprinter L, Umzug Stuttgart-West nach Esslingen", quantity: 1, unitRate: kernV1 },
        { description: "Halteverbot beim Beladen", quantity: 1, unitRate: 150 },
        { description: "60 Umzugskartons", quantity: 1, unitRate: 150 },
      ],
      gewaehltProzent: null,
      createdAt: new Date("2026-11-03T15:20:00+01:00"),
      lockedAt: new Date("2026-11-03T16:00:00+01:00"),
    }),
    versionsZeile({
      id: v2,
      version: 2,
      status: "gesperrt",
      referenceDate: "2026-11-04",
      stand: standV2,
      overrides: [margeGewaehlt],
      kvItems: [
        { description: "Umzugsteam 3 Personen und Sprinter L, Umzug Stuttgart-West nach Esslingen", quantity: 1, unitRate: kernV2 },
        { description: "Halteverbot beidseitig", quantity: 1, unitRate: 300 },
        { description: "Demontage & Montage (Wandschrank, Bett)", quantity: 1, unitRate: 60 },
        { description: "60 Umzugskartons", quantity: 1, unitRate: 170 },
      ],
      gewaehltProzent: 38,
      createdAt: new Date("2026-11-04T10:30:00+01:00"),
      lockedAt: gesperrtAm,
      sentAt: gesendetAm,
      sentVia: "whatsapp",
    }),
    versionsZeile({
      id: v3,
      version: 3,
      status: "entwurf",
      referenceDate: heute,
      stand: standV3,
      overrides: [margeGewaehlt, zeitpostenWandschrank],
      kvItems: [],
      gewaehltProzent: 38,
      createdAt: new Date("2026-11-05T10:40:00+01:00"),
    }),
  ]);
  await upsertQuotation(weber, {
    fixedPrice: standV2.k.festpreis.toFixed(2),
    isVariable: false,
    summary: "Umzug Stuttgart-West nach Esslingen, 3 Zimmer.",
    validUntil: "2026-11-18",
    serviceType: "move",
    lineItems: [
      { type: "other", description: "Umzugsteam 3 Personen und Sprinter L", quantity: 1, unitRate: kernV2.toFixed(2), sortOrder: 0 },
      { type: "other", description: "Halteverbot beidseitig", quantity: 1, unitRate: "300.00", sortOrder: 1 },
      { type: "other", description: "Demontage & Montage (Wandschrank, Bett)", quantity: 1, unitRate: "60.00", sortOrder: 2 },
      { type: "other", description: "60 Umzugskartons", quantity: 1, unitRate: "170.00", sortOrder: 3 },
    ],
  });
  await db.update(quotations).set({ calculationVersionId: v2 }).where(eq(quotations.dealRecordId, weber));
  await createDealDocument({
    workspaceId: workspace.id,
    dealRecordId: weber,
    documentType: "quotation",
    fileName: "KV-Familie-Weber-v2.pdf",
    fileSize: pdf.length,
    mimeType: "application/pdf",
    fileContent: pdfB64,
    notifyCustomer: false,
    calculationVersionId: v2,
  });

  await db.insert(agentDrafts).values({
    workspaceId: workspace.id,
    dealRecordId: weber,
    conversationId: waGespraech.id,
    channelAccountId: waKonto.id,
    messageClass: "followup",
    sequenceId: "nachfass",
    sequenceStep: 1,
    draftText:
      "Guten Tag, kurze Nachfrage zum Kostenvoranschlag. Melden Sie sich gern, wenn noch etwas unklar ist.",
    status: "pending",
    expiresAt: new Date("2026-11-13T12:00:00+01:00"),
  });

  const link = await ensureCustomerStatusLink({
    workspaceId: workspace.id,
    dealRecordId: weber,
    createdBy: userId,
  });
  if (!link.created || !link.token) throw new Error("Kundenlink wurde nicht angelegt.");
  await db
    .update(customerStatusLinks)
    .set({
      viewCount: 3,
      sessionCount: 3,
      firstViewedAt: new Date("2026-11-04T18:00:00+01:00"),
      lastViewedAt: new Date("2026-11-06T07:12:00+01:00"),
    })
    .where(eq(customerStatusLinks.dealRecordId, weber));

  const anfrage = await datensatz(dealObjekt, {
    name: "Herr Testmann",
    stage: anfrageStufe,
    operating_company: beispiel,
    source_channel: quelleTelefon,
    zimmer: 2,
    move_from_address: adresse("Musterstraße 8", "Tübingen", "72072"),
    move_to_address: adresse("Probenweg 3", "Reutlingen", "72764"),
  });

  const sommer = await datensatz(dealObjekt, {
    name: "Familie Sommer",
    stage: durchgefuehrtStufe,
    operating_company: beispiel,
    source_channel: quelleEmpfehlung,
    zimmer: 4,
    move_date: "2026-11-03",
    move_completed_at: new Date("2026-11-03T16:30:00+01:00"),
    rechnung_faellig_am: "2026-11-17",
    move_from_address: adresse("Beispielallee 5", "Ludwigsburg", "71638"),
    move_to_address: adresse("Musterplatz 9", "Stuttgart", "70174"),
  });
  await upsertQuotation(sommer, {
    fixedPrice: "2480.00",
    isVariable: false,
    summary: "Umzug Ludwigsburg nach Stuttgart, durchgeführt.",
    serviceType: "move",
    lineItems: [{ type: "other", description: "Umzug, 4 Zimmer", quantity: 1, unitRate: "2480.00", sortOrder: 0 }],
  });
  await createDealDocument({
    workspaceId: workspace.id,
    dealRecordId: sommer,
    documentType: "invoice",
    fileName: "RE-Familie-Sommer.pdf",
    fileSize: pdf.length,
    mimeType: "application/pdf",
    fileContent: pdfB64,
    notifyCustomer: false,
  });
  await createPayment(workspace.id, sommer, {
    date: "2026-11-01",
    amount: "500.00",
    payer: "Familie Sommer",
    paymentMethod: "bank_transfer",
    reference: "Anzahlung Testdaten",
  });
  await emitEvent({
    workspaceId: workspace.id,
    recordId: sommer,
    objectSlug: "deals",
    eventType: "customer.marked_paid",
    payload: { amountCents: 198000, variant: "final", method: "bank_transfer" },
  });
  const meldungen = await ladeZahlungsmeldungen(workspace.id, sommer);
  if (meldungen.length !== 1 || meldungen[0]?.betragCent !== 198000) {
    throw new Error("Offene Meldung „bezahlt“ fehlt.");
  }

  const probe = await datensatz(dealObjekt, {
    name: "Herr Probe",
    stage: verlorenStufe,
    operating_company: kottke,
    source_channel: quelleWhatsapp,
    loss_reason: verlustZuTeuer,
    loss_reason_note: "Testdaten: Angebot zu teuer.",
    zimmer: 1,
    move_from_address: adresse("Probenring 2", "Böblingen", "71032"),
    move_to_address: adresse("Beispielpfad 6", "Sindelfingen", "71063"),
  });

  // ─── Plan 15: zwei Deals in der Lage von Viktoria (keine Adressen im Lead, 37 Positionen, Eckbank) ───
  // (V1) Chat mit beiden PLZ und „10 bis 15 Umzugskartons“, Route aus Testdaten (Cache), Google ungefähr.
  // (V2) ohne Chat, ohne Adressen: alles geschätzt (2 Touren, 5 Personen, 30 + 3 × 25 + 30 min), keine Route.
  const { dealCalculationRoutes } = await import("@/db/schema/deal-calculation-routes");
  const { punkteSchluessel, googleMapsLink } = await import("@/lib/route-link");
  const { punkteAusVersion } = await import("@/services/kalkulations-route");
  const kodiere = (punkte: [number, number][]): string => {
    let alt = [0, 0];
    let aus = "";
    const zahl = (n: number) => {
      let v = n < 0 ? ~(n << 1) : n << 1;
      let t = "";
      while (v >= 0x20) {
        t += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
        v >>= 5;
      }
      return t + String.fromCharCode(v + 63);
    };
    for (const [lng, lat] of punkte) {
      const la = Math.round(lat * 1e5);
      const ln = Math.round(lng * 1e5);
      aus += zahl(la - alt[0]) + zahl(ln - alt[1]);
      alt = [la, ln];
    }
    return aus;
  };
  const NAMEN_KATALOG = ["Bett", "Kleiderschrank", "Sofa", "Esstisch", "Stuhl", "Kommode", "Regal", "Schreibtisch", "Waschmaschine", "Kühlschrank", "Fernseher", "Nachttisch", "Couchtisch", "Sessel"];
  const NAMEN_OHNE = [
    "Eckbank", "Gartensessel", "Kinderhochbett mit Spielzelt", "Schwebetürenschrank", "Kindertisch", "Kinderstuhl", "Spielküche",
    "Spielwaschbecken", "Teppich groß", "Läufer", "Drucker", "Stoffboxen", "Bücherstapel", "Wäscheständer", "Staubsauger",
    "Bügelbrett", "Schuhregal", "Garderobe", "Standlampe", "Wandbild", "Gartentisch", "Sonnenschirm", "Getränkekisten",
  ];
  const viktoriaInventar = (deal: string, mitFoto: boolean) => {
    const zeilen = [...NAMEN_KATALOG.map((n) => ({ name: n, ohne: false })), ...NAMEN_OHNE.map((n) => ({ name: n, ohne: true }))];
    return zeilen.map((z, i) => ({
      workspaceId: workspace.id,
      dealRecordId: deal,
      name: z.name,
      category: "Möbel",
      quantity: z.name === "Stuhl" ? 6 : z.name === "Stoffboxen" ? 12 : z.name === "Getränkekisten" ? 8 : z.name === "Regal" ? 4 : z.name === "Wandbild" ? 6 : z.name === "Kinderstuhl" ? 2 : z.name === "Gartensessel" ? 4 : 1,
      sizeClass: (z.name === "Eckbank" ? "sperrig" : z.ohne ? "mittel" : "gross") as "sperrig" | "mittel" | "gross",
      heavyFlag: false,
      fragileFlag: false,
      disassemblyRequired: z.name === "Bett" || z.name === "Kleiderschrank",
      moveFlag: true,
      photoAttachmentId: mitFoto && i < 8 ? kachel((i % 14) + 1) : null,
      volumeCbmEstimate: null,
      confidence: "mittel" as const,
      source: (mitFoto && i < 30 ? "foto" : "chat") as "foto" | "chat",
      needsPhoto: false,
      dismantlingOwner: (z.name === "Bett" || z.name === "Kleiderschrank" ? "company" : "none") as "company" | "none",
      assemblyOwner: (z.name === "Bett" || z.name === "Kleiderschrank" ? "company" : "none") as "company" | "none",
      sortOrder: i,
    }));
  };
  const KATALOG_WERTE: Record<string, { key: string; cbm: number; kg: number; trage: number; de: number | null; mo: number | null; tr: number; g: "klein" | "mittel" | "gross" | "sperrig" }> = {
    Bett: { key: "bett_180", cbm: 1.2, kg: 70, trage: 16, de: 30, mo: 45, tr: 2, g: "gross" },
    Kleiderschrank: { key: "kleiderschrank_3t", cbm: 1.8, kg: 90, trage: 20, de: 60, mo: 90, tr: 2, g: "gross" },
    Sofa: { key: "sofa_3", cbm: 1.6, kg: 70, trage: 16, de: null, mo: null, tr: 2, g: "gross" },
    Esstisch: { key: "esstisch", cbm: 0.8, kg: 40, trage: 10, de: 20, mo: 25, tr: 2, g: "gross" },
    Stuhl: { key: "stuhl", cbm: 0.15, kg: 6, trage: 3, de: null, mo: null, tr: 1, g: "mittel" },
    Kommode: { key: "kommode", cbm: 0.5, kg: 40, trage: 8, de: null, mo: null, tr: 2, g: "mittel" },
    Regal: { key: "regal_billy", cbm: 0.35, kg: 30, trage: 8, de: 20, mo: 30, tr: 1, g: "mittel" },
    Schreibtisch: { key: "schreibtisch", cbm: 0.7, kg: 35, trage: 10, de: 20, mo: 25, tr: 2, g: "gross" },
    Waschmaschine: { key: "waschmaschine", cbm: 0.4, kg: 75, trage: 12, de: null, mo: null, tr: 2, g: "mittel" },
    Kühlschrank: { key: "kuehlschrank", cbm: 0.6, kg: 60, trage: 10, de: null, mo: null, tr: 2, g: "mittel" },
    Fernseher: { key: "tv", cbm: 0.15, kg: 20, trage: 6, de: null, mo: null, tr: 1, g: "mittel" },
    Nachttisch: { key: "nachttisch", cbm: 0.15, kg: 12, trage: 3, de: null, mo: null, tr: 1, g: "klein" },
    Couchtisch: { key: "couchtisch", cbm: 0.3, kg: 20, trage: 4, de: null, mo: null, tr: 1, g: "mittel" },
    Sessel: { key: "sessel", cbm: 0.6, kg: 25, trage: 6, de: null, mo: null, tr: 1, g: "mittel" },
  };
  const viktoriaErgebnis = (fahrt: {
    anfahrt: { km: number; min: number; quelle: "google" | "angenommen" };
    strecke: { km: number; min: number; quelle: "google" | "angenommen" };
    rueckfahrt: { km: number; min: number; quelle: "google" | "angenommen" };
    team: number;
  }) => {
    const basis = weberErgebnis({ volumen: 11.7, arbeitPm: 520, zeitpostenPm: 0, halteverbotSeiten: 1, montage: true, margeProzent: 38, margeQuelle: "vorschlag" });
    const inv = viktoriaInventar("x", false);
    const positionen = inv.map((z, i) => {
      const k = KATALOG_WERTE[z.name];
      const ohne = !k;
      return {
        positionId: `freitext-${i}`,
        name: z.name,
        menge: z.quantity,
        volumenCbm: k ? k.cbm : z.name === "Eckbank" ? 2 : 0.4,
        gewichtKg: k ? k.kg : z.name === "Eckbank" ? 120 : 30,
        zerlegt: z.dismantlingOwner === "company",
        demontageQuelle: (z.dismantlingOwner === "company" ? "wunsch" : "keine_regel") as "wunsch" | "keine_regel",
        ungeprueft: ohne,
      };
    });
    const details = inv.map((z, i) => {
      const k = KATALOG_WERTE[z.name];
      return k
        ? { positionId: `freitext-${i}`, katalogKey: k.key, katalogTreffer: true, groessenklasse: k.g, mindestTraeger: k.tr, trageMin: k.trage, demontageMin: k.de, montageMin: k.mo }
        : { positionId: `freitext-${i}`, katalogKey: null, katalogTreffer: false, groessenklasse: z.name === "Eckbank" ? ("sperrig" as const) : ("mittel" as const), mindestTraeger: z.name === "Eckbank" ? 3 : 1, trageMin: z.name === "Eckbank" ? 50 : 10, demontageMin: null, montageMin: null };
    });
    const touren = 2;
    const fahrtMin = fahrt.anfahrt.min + (2 * touren - 1) * fahrt.strecke.min + fahrt.rueckfahrt.min;
    const fahrtH = Math.round((fahrtMin / 60) * fahrt.team * 1.1 * 100) / 100;
    const posten = basis.ergebnis.kosten.posten.map((p) =>
      p.key === "personal.fahrt"
        ? { ...p, menge: fahrtH, satz: 22.5, betrag: Math.round(fahrtH * 22.5 * 100) / 100, formel: `${fahrtH.toLocaleString("de-DE")} h × 22,50 €` }
        : p
    );
    return {
      ...basis.ergebnis,
      team: { groesse: fahrt.team, quelle: "traeger" as const },
      kosten: { ...basis.ergebnis.kosten, posten, personalStunden: { ...basis.ergebnis.kosten.personalStunden, pufferProzent: 10 } },
      positionen,
      positionenDetails: details,
      zuordnungFreitext: { nichtZugeordnet: NAMEN_OHNE },
      fahrtAufschluesselung: { ...fahrt, fahrten: touren, wege: 2 * touren - 1, fahrtMin },
      fahrzeugoptionen: [{ id: "sprinter_l", name: "Sprinter L", fahrten: touren, km: 60, fahrtMin, teamgroesse: fahrt.team, uhrzeitMin: 0, auslastung: 0.9 }],
      empfehlungOptionId: "sprinter_l",
      mietstation: { ...basis.ergebnis.mietstation, quelle: fahrt.anfahrt.quelle, anfahrtMin: fahrt.anfahrt.min, anfahrtKm: fahrt.anfahrt.km, rueckfahrtMin: fahrt.rueckfahrt.min, rueckfahrtKm: fahrt.rueckfahrt.km },
      zeiten: { ...basis.ergebnis.zeiten, fahrtMin, methode: "volumen" as const },
      hinweise: [{ typ: "traeger", text: "Eckbank: mindestens 3 Träger nötig" }],
      annahmen: [
        "Etage an der Beladeadresse unbekannt: günstig Erdgeschoss, ungünstig 3. OG ohne Aufzug.",
        "Tragestrecke an der Beladeadresse unbekannt: 10 m angenommen.",
        "Tragestrecke an der Entladeadresse unbekannt: 10 m angenommen.",
        ...NAMEN_OHNE.slice(0, 3).map((n) => `Position "${n}" ohne Katalogtreffer: 0.4 m³ (Standard der Größenklasse mittel) und 30 kg (Standard der Größenklasse mittel) je Stück.`),
      ],
      schaetzung: null,
    };
  };
  const viktoriaKontakt = async (name: string, telefon: string) => {
    const [k] = await db.insert(inboxContacts).values({ workspaceId: workspace.id, displayName: name, phone: telefon, phoneCanonical: telefon }).returning();
    return k!;
  };
  const v1Deal = await datensatz(dealObjekt, { name: "Viktoria Muster (Chat)", stage: angebotStufe, operating_company: beispiel, source_channel: quelleWhatsapp, move_date: "2026-11-28" });
  const v2Deal = await datensatz(dealObjekt, { name: "Viktoria Muster (ohne Angaben)", stage: angebotStufe, operating_company: beispiel, source_channel: quelleWhatsapp, move_date: "2026-11-28" });
  await db.insert(dealInventoryItems).values(viktoriaInventar(v1Deal, true));
  await db.insert(dealInventoryItems).values(viktoriaInventar(v2Deal, false));
  const vk = await viktoriaKontakt("Viktoria Muster", "+491550000301");
  const [vGespraech] = await db
    .insert(inboxConversations)
    .values({ workspaceId: workspace.id, channelAccountId: waKonto.id, contactId: vk.id, externalThreadId: "+491550000301", status: "open", dealRecordId: v1Deal, lastMessageAt: new Date("2026-11-08T10:05:00+01:00"), lastMessagePreview: "10 bis 15 Umzugskartons", unreadCount: 0 })
    .returning();
  await db.insert(inboxMessages).values([
    { workspaceId: workspace.id, conversationId: vGespraech!.id, direction: "inbound", status: "received", fromAddress: "+491550000301", toAddress: "+491550000101", body: "Hallo, wir ziehen Ende November von 70372 Stuttgart nach 71032 Böblingen um.", sentAt: new Date("2026-11-08T10:00:00+01:00") },
    { workspaceId: workspace.id, conversationId: vGespraech!.id, direction: "outbound", status: "sent", fromAddress: "+491550000101", toAddress: "+491550000301", body: "Gern! Ist es eher 70173 oder 70372?", sentAt: new Date("2026-11-08T10:02:00+01:00") },
    { workspaceId: workspace.id, conversationId: vGespraech!.id, direction: "inbound", status: "received", fromAddress: "+491550000301", toAddress: "+491550000101", body: "70372. Wir haben so 10 bis 15 Umzugskartons, packen selbst.", sentAt: new Date("2026-11-08T10:05:00+01:00") },
  ]);
  const heuteV = (await import("@/services/rechner/quelle")).heuteBerlin();
  const viktoriaVersion = async (deal: string, ergebnis: ReturnType<typeof viktoriaErgebnis>, overrides: unknown[]) => {
    const l = await ladeLeadDaten(workspace.id, deal);
    if (!l) throw new Error("Lead Viktoria fehlt");
    const id = randomUUID();
    const ov = overrides as Parameters<typeof grundlageAus>[2];
    const request = anfrageMitUebersteuerungen(rechnerAnfrageAus(l), ov, { referenceDate: heuteV });
    await db.insert(dealCalculationVersions).values({
      id, workspaceId: workspace.id, dealRecordId: deal, version: 1, status: "entwurf", pricingMode: "fest", referenceDate: heuteV,
      inputs: grundlageAus(l, ergebnis, ov), overrides: ov, rechnerRequest: request, rechnerResult: ergebnis, error: null,
      costLines: kostenzeilenAus(ergebnis, ov), margin: { vorschlagProzent: 38, gruende: MARGE_VORSCHLAG.gruende, gewaehltProzent: null },
      priceCents: Math.round(ergebnis.preis.festpreis * 100), packagePrices: [], kvItems: [], tariff: ergebnis.tarif,
      createdBy: userId, createdAt: new Date(), updatedAt: new Date(), lockedAt: null, lockedBy: null, sentAt: null, sentVia: null,
    });
    return { id, request };
  };
  const e1 = viktoriaErgebnis({
    anfahrt: { km: 9, min: 18, quelle: "google" },
    strecke: { km: 21, min: 25, quelle: "google" },
    rueckfahrt: { km: 17, min: 21, quelle: "google" },
    team: 3,
  });
  const ver1 = await viktoriaVersion(v1Deal, e1, []);
  const punkte = punkteAusVersion({ rechnerRequest: ver1.request, rechnerResult: e1 });
  if (punkte) {
    const S: [number, number] = [9.165, 48.815];
    const B: [number, number] = [9.226, 48.808];
    const E: [number, number] = [9.012, 48.684];
    await db.insert(dealCalculationRoutes).values({
      calculationVersionId: ver1.id,
      workspaceId: workspace.id,
      punkteSchluessel: punkteSchluessel(punkte),
      teilstrecken: [
        { von: "Station", nach: "Beladen", km: 9, minuten: 18, polyline: kodiere([S, [9.19, 48.82], B]), haupt: false },
        { von: "Beladen", nach: "Entladen", km: 21, minuten: 25, polyline: kodiere([B, [9.18, 48.77], [9.1, 48.72], E]), haupt: true },
        { von: "Entladen", nach: "Station", km: 17, minuten: 21, polyline: kodiere([E, [9.08, 48.76], S]), haupt: false },
      ],
      googleLink: googleMapsLink(punkte),
      berechnetAm: new Date(),
    });
  }
  const geschaetzt = { km: 20, min: 30, quelle: "angenommen" as const };
  const e2 = viktoriaErgebnis({ anfahrt: geschaetzt, strecke: { km: 15, min: 25, quelle: "angenommen" }, rueckfahrt: geschaetzt, team: 5 });
  await viktoriaVersion(v2Deal, { ...e2, mietstation: { ...e2.mietstation, quelle: "angenommen" } }, [
    { id: randomUUID(), art: "eingabe", key: "umzugskartons", umgedeutet: "kartons", rechnerwert: null, wert: 15, grund: "Kundin: 15 Kartons", autor: { userId, quelle: "mensch" }, zeit: "2026-11-08T11:00:00+01:00", fotoRef: null },
  ]);

  for (const id of [weber, anfrage, sommer, probe]) {
    await aktualisiereWartet(workspace.id, id);
  }

  const ergebnis = {
    workspaceId: workspace.id,
    userId,
    email: EMAIL,
    password: PASSWORD,
    firmen: { kottke, beispiel },
    deals: {
      viktoriaChat: v1Deal,
      viktoriaOhne: v2Deal,
      angebot: weber,
      anfrage,
      durchgefuehrt: sommer,
      verloren: probe,
    },
  };
  console.log("Testdaten angelegt.");
  console.log(`Anmeldung: ${EMAIL} / ${PASSWORD}`);
  console.log(JSON.stringify(ergebnis, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });

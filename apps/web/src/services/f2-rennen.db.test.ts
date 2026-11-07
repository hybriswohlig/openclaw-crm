import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fix-Welle F2 zu Plan 5b gegen eine Wegwerf-Datenbank, mit Rennen:
 * - I2: Sperren leitet Paket- und Tagespreise aus Ergebnis und Liste ab und sperrt
 *   nur den gelesenen Stand (`updated_at`), auch bei „Tage anbieten“ mit gleicher
 *   Zahl an Anpassungen.
 * - I3: Paketpreis-Anpassung wirkt an jedem Tag als Differenz, Untergrenze je Tag.
 * - I1: Kundenwahl gegen eine Handänderung, die genau einer anderen Wahl gleicht.
 * - M3: eine Wahl ohne Preis sperrt nicht still.
 * Echte Dienste (`sperren`, `uebersteuern`, `tageSetzen`, `upsertQuotation`,
 * Portal-Wahl) mit dem DB-Speicher; nur Rechner, Lead und Posten je Wahl sind
 * Attrappen. Läuft nur mit ANNAHME_TEST_DATABASE_URL.
 */
const url = process.env.ANNAHME_TEST_DATABASE_URL;

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.ANNAHME_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 5 });
  return { db: drizzle(client, { schema }) };
});
vi.mock("./activity-events", () => ({ emitEvent: async () => {} }));
vi.mock("./wartet", () => ({ aktualisiereWartet: async () => {}, aktualisiereWartetNachBesuch: async () => {} }));
// Posten je Wahl (Task P): ein Kern-Posten mit genau dem Preis, wie im Unit-Test des Dienstes.
vi.mock("./rechner/wahl-posten", async (orig) => {
  const echt = await orig<typeof import("./rechner/wahl-posten")>();
  const kern = (preis: number, wo: string) => [{ description: `Umzug ${wo}`, quantity: 1, unitRate: preis }];
  return {
    ...echt,
    postenJeWahl: (input: { version: import("@/lib/angebot-wahl").VersionsPreise }) => {
      const v = input.version;
      return {
        ...v,
        packagePrices: v.packagePrices.map((p) => ({ ...p, kvItems: p.festpreis === null ? [] : kern(p.festpreis, p.slug) })),
        dayPrices: v.dayPrices.map((t) => ({
          ...t,
          kvItems: t.festpreis === null ? [] : kern(t.festpreis, t.datum),
          paketpreise: t.paketpreise?.map((p) => ({ ...p, kvItems: p.festpreis === null ? [] : kern(p.festpreis, `${p.slug} ${t.datum}`) })) ?? null,
        })),
      };
    },
  };
});

import type { RechnerAnfrage } from "./rechner/eingabe";
import type { RechnerErgebnis } from "./rechner/client";
import type { HebelArt } from "./rechner/kv-posten";
import type { Autor, VersionsOptionen, VersionsSpeicher, VersionsZeile } from "./kalkulation-versionen";

const MENSCH: Autor = { userId: null, quelle: "mensch" };
const FR = "2026-11-20";
const SA = "2026-11-21";
const lead = {
  von: "Böblingen", nach: "Stuttgart", etageVon: 0, etageNach: null, zugangVon: null, zugangNach: null,
  umzugsdatum: FR, wohnflaecheQm: null, zimmer: 3, tragestreckeVonM: null, tragestreckeNachM: null,
  halteverbot: false, packService: false, kartons: null, inventar: [],
};

/** Steuerbare Rechner-Attrappe: Basis 1.290, Komfort 1.490 am Basistag; Samstag +100 €, Selbstkosten am Samstag einstellbar. */
const rechnerStand = { komfortSelbstkostenSa: 894 };
function rechnerAntwort(a: RechnerAnfrage): RechnerErgebnis {
  const pak: Record<string, number> = { basis: 1290, komfort: 1490 };
  const hebel = typeof a.paket_hebel === "string" ? (JSON.parse(a.paket_hebel) as Record<string, HebelArt[]>) : null;
  const paketpreise = hebel
    ? Object.keys(hebel).map((slug) => ({ slug, festpreis: pak[slug] ?? null, selbstkosten: (pak[slug] ?? 0) * 0.6, rundungEur: 10, margeProzent: 40 }))
    : undefined;
  const tage = typeof a.tage === "string" ? (JSON.parse(a.tage) as string[]) : null;
  const sa = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay() === 6;
  return {
    montageJePosition: true,
    preis: { festpreis: 1490, selbstkosten: 800, rundungEur: 10, margeWirksamProzent: 40, nichtKalkulierbarGrund: null, margeVorschlag: { prozent: 40, gruende: [] } },
    kosten: { selbstkosten: 800, posten: [{ key: "personal.arbeit", bezeichnung: "Personal Arbeit", menge: 10, einheit: "h", satz: 20, betrag: 200 }] },
    volumen: { nettoCbm: 20 },
    tarif: { id: "t1", version: 3, marke: "ceylan" },
    schaetzung: null,
    ...(paketpreise ? { paketpreise } : {}),
    ...(tage
      ? {
          tagespreise: tage.map((datum) => ({
            datum, wochentag: sa(datum) ? ("sa" as const) : ("fr" as const), feiertag: false,
            festpreis: 1490 + (sa(datum) ? 100 : 0), selbstkosten: 800, margeProzent: 40, gruende: [],
            paketpreise: paketpreise
              ? paketpreise.map((p) => ({
                  ...p,
                  festpreis: p.festpreis === null ? null : p.festpreis + (sa(datum) ? 100 : 0),
                  selbstkosten: sa(datum) && p.slug === "komfort" ? rechnerStand.komfortSelbstkostenSa : p.selbstkosten,
                }))
              : null,
          })),
        }
      : {}),
  } as RechnerErgebnis;
}

/** Ein Tor: `warte()` blockiert, bis `frei()`; `erreicht` meldet, dass jemand wartet. */
function tor() {
  let frei!: () => void;
  const offen = new Promise<void>((r) => (frei = r));
  let erreicht!: () => void;
  const angekommen = new Promise<void>((r) => (erreicht = r));
  return { warte: async () => (erreicht(), await offen), frei: () => frei(), angekommen };
}

describe.skipIf(!url)("F2: Rennen um Versionen, Tage und Kundenwahl (DB)", { timeout: 30_000 }, () => {
  let sql: postgres.Sql;
  let kv: typeof import("./kalkulation-versionen");
  let speicherMod: typeof import("./kalkulation-versionen-speicher");
  let portal: typeof import("./customer-portal-data");
  let quotations: typeof import("./quotations");
  const ws = randomUUID();
  const dealObj = randomUUID();
  const firmaObj = randomUUID();
  const attrFirma = randomUUID();
  const deal = randomUUID();
  const firma = randomUUID();
  const link = randomUUID();
  const token = randomUUID().replace(/-/g, "");
  const ctx = { ipAddress: "203.0.113.9", userAgent: "test" };
  const ids = { basis: "", komfort: "", quotation: "" };

  /** Dienst-Abhängigkeiten: echter DB-Speicher (optional mit Toren), Rechner und Lead als Attrappe. */
  function opts(speicher?: Partial<VersionsSpeicher>): VersionsOptionen {
    const echt = speicherMod.dbVersionsSpeicher;
    return {
      speicher: { ...echt, ...speicher },
      ladeLead: async () => lead,
      rechner: async (a) => ({ ok: true as const, ergebnis: rechnerAntwort(a) }),
      melde: async () => ({ ok: true as const }),
      jetzt: () => new Date("2026-11-07T09:00:00Z"),
      nachher: () => {},
      hatPakete: async () => true,
      ladePaketHebel: async () => ({ basis: [], komfort: ["halteverbot", "montage"] as HebelArt[] }),
      ladeCache: async () => null,
      nachSperren: async () => {},
      ladeSchalter: async () => ({ angebotAusKalkulation: true, tagespreise: true }),
      istKottke: async () => false,
      ladeAuftraege: async () => [],
      ladeWunschtermine: async () => [],
    };
  }
  const tageEingabe = (empfohlen: string, tage = [FR, SA]) => ({
    tage: tage.map((datum) => ({ datum, slots: [{ label: "Vormittag", startTime: "08:00", endTime: "12:00" }], note: null, empfohlen: datum === empfohlen })),
    uebersteuerungen: [],
  });
  const version = async (n: number): Promise<VersionsZeile> => (await speicherMod.dbVersionsSpeicher.lesen(ws, deal, n))!;
  const quotation = async () =>
    (await sql`select fixed_price, calculation_version_id from quotations where deal_record_id = ${deal}`)[0] as { fixed_price: string; calculation_version_id: string | null };
  const paketAmTag = (v: VersionsZeile, datum: string, slug: string) => v.dayPrices.find((t) => t.datum === datum)?.paketpreise?.find((p) => p.slug === slug)?.festpreis;

  beforeAll(async () => {
    sql = postgres(url!, { max: 3 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Test', ${`t-${ws}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${dealObj}, ${ws}, 'deals', 'Deal', 'Deals')`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${firmaObj}, ${ws}, 'operating_companies', 'Firma', 'Firmen')`;
    await sql`insert into attributes (id, object_id, slug, title, type) values (${attrFirma}, ${dealObj}, 'operating_company', 'Firma', 'record_reference')`;
    await sql`insert into records (id, object_id) values (${deal}, ${dealObj})`;
    await sql`insert into records (id, object_id) values (${firma}, ${firmaObj})`;
    await sql`insert into record_values (id, record_id, attribute_id, referenced_record_id) values (${randomUUID()}, ${deal}, ${attrFirma}, ${firma})`;
    await sql`insert into operating_company_portal_settings (operating_company_record_id, workspace_id, angebot_aus_kalkulation, tagespreise_enabled)
      values (${firma}, ${ws}, true, true)`;
    await sql`insert into customer_status_links (id, workspace_id, deal_record_id, token) values (${link}, ${ws}, ${deal}, ${token})`;
    kv = await import("./kalkulation-versionen");
    speicherMod = await import("./kalkulation-versionen-speicher");
    portal = await import("./customer-portal-data");
    quotations = await import("./quotations");
  });

  beforeEach(async () => {
    for (const t of ["kva_confirmations", "customer_date_selections", "quotation_date_offers", "quotation_package_options", "quotations", "deal_calculation_versions"]) {
      await sql.unsafe(`delete from ${t} where deal_record_id = $1`, [deal]);
    }
    rechnerStand.komfortSelbstkostenSa = 894;
    ids.basis = randomUUID();
    ids.komfort = randomUUID();
    ids.quotation = randomUUID();
    await sql`insert into quotations (id, deal_record_id, fixed_price, is_variable, service_type) values (${ids.quotation}, ${deal}, '999.00', false, 'kitchen_installation')`;
    await sql`insert into quotation_package_options (id, workspace_id, deal_record_id, catalogue_slug, display_name, price_cents, is_recommended, sort_order) values
      (${ids.basis}, ${ws}, ${deal}, 'basis', 'Basis', 90000, false, 0),
      (${ids.komfort}, ${ws}, ${deal}, 'komfort', 'Komfort', 120000, true, 1)`;
  });

  afterAll(async () => {
    await sql`delete from workspaces where id = ${ws}`;
    await sql.end();
  });

  // ─── I2 ────────────────────────────────────────────────────────────────

  it("I2, Weg 1: Sperren zwischen `anhaengen` und `aktualisieren` einer Paketpreis-Anpassung sperrt den neuen Preis", async () => {
    await kv.entwurfHolenOderAnlegen(ws, deal, MENSCH, opts());
    const t = tor();
    // `uebersteuern` hängt an und hält dann vor dem Schreiben der neuen Preise an.
    const langsam = opts({
      aktualisieren: async (id, patch) => {
        await t.warte();
        return speicherMod.dbVersionsSpeicher.aktualisieren(id, patch);
      },
    });
    const lauf = kv.uebersteuern(ws, deal, 1, { art: "paketpreis", key: "komfort", wert: { betrag: 1600 }, grund: "Dritter Helfer" }, MENSCH, langsam);
    await t.angekommen;
    // Gespeichert stehen noch die alten Preise neben der neuen Liste.
    expect((await version(1)).packagePrices.find((p) => p.slug === "komfort")?.festpreis).toBe(1490);
    const gesperrt = await kv.sperren(ws, deal, 1, MENSCH, {}, opts());
    t.frei();
    const r = await lauf;

    expect(gesperrt.version.packagePrices.find((p) => p.slug === "komfort")).toMatchObject({ festpreis: 1600, rechnerFestpreis: 1490 });
    // Die Meldung von `uebersteuern` stimmt: die gesperrte Version enthält die Anpassung samt Preis.
    expect(r.version.status).toBe("gesperrt");
    expect(r.version.packagePrices.find((p) => p.slug === "komfort")?.festpreis).toBe(1600);
    const [o] = await sql`select price_cents from quotation_package_options where id = ${ids.komfort}`;
    expect(o.price_cents).toBe(160000);
    expect(await quotation()).toMatchObject({ fixed_price: "1600.00" });
  });

  it("I2, Weg 1 ohne Rennen: scheitert `aktualisieren` nach dem Anhängen, sperrt das nächste Sperren trotzdem den angepassten Preis", async () => {
    await kv.entwurfHolenOderAnlegen(ws, deal, MENSCH, opts());
    const kaputt = opts({ aktualisieren: async () => { throw new Error("Verbindung weg"); } });
    await expect(
      kv.uebersteuern(ws, deal, 1, { art: "paketpreis", key: "basis", wert: { betrag: 1350 }, grund: "Etage" }, MENSCH, kaputt)
    ).rejects.toThrow("Verbindung weg");
    const { version: v } = await kv.sperren(ws, deal, 1, MENSCH, {}, opts());
    expect(v.packagePrices.find((p) => p.slug === "basis")?.festpreis).toBe(1350);
  });

  it("I2, Weg 2: „Tage anbieten“ mit gleicher Zahl an Anpassungen landet vor dem Sperren: nichts gesperrt, die neuen Tage bleiben", async () => {
    await kv.entwurfHolenOderAnlegen(ws, deal, MENSCH, opts());
    await kv.tageSetzen(ws, deal, 1, MENSCH, tageEingabe(FR), opts());
    const vorher = await version(1);
    const t = tor();
    const langsam = opts({
      sperrenUndAngebot: async (...a) => {
        await t.warte();
        return speicherMod.dbVersionsSpeicher.sperrenUndAngebot(...a);
      },
    });
    const sperrLauf = kv.sperren(ws, deal, 1, MENSCH, {}, langsam).then(
      () => null,
      (e: unknown) => e
    );
    await t.angekommen;
    // Dazwischen: Empfehlung auf den Samstag, keine Anpassung (Anzahl bleibt gleich).
    await new Promise((r) => setTimeout(r, 5));
    await kv.tageSetzen(ws, deal, 1, MENSCH, tageEingabe(SA), opts());
    expect((await version(1)).overrides.length).toBe(vorher.overrides.length);
    t.frei();
    const fehler = await sperrLauf;

    expect(fehler).toMatchObject({ code: "UNGUELTIG", message: "Die Kalkulation wurde gerade geändert. Bitte erneut sperren." });
    const v = await version(1);
    expect(v.status).toBe("entwurf");
    expect(v.dayPrices.find((d) => d.empfohlen)?.datum).toBe(SA);
    expect(await sql`select id from quotation_date_offers where deal_record_id = ${deal}`).toHaveLength(0);
    expect((await quotation()).calculation_version_id).toBeNull();

    // Erneut gesperrt: der Samstag ist empfohlen, die Quotation trägt Komfort am Samstag.
    await kv.sperren(ws, deal, 1, MENSCH, {}, opts());
    const tage = await sql`select offer_date::text as d, is_recommended from quotation_date_offers where deal_record_id = ${deal} order by offer_date`;
    expect(tage.map((x) => [x.d, x.is_recommended])).toEqual([[FR, false], [SA, true]]);
    expect(await quotation()).toMatchObject({ fixed_price: "1590.00" });
  });

  it("I2: frisch angelegter Entwurf (updated_at mit Mikrosekunden aus der DB) sperrt ohne Fehlalarm", async () => {
    const { version: v } = await kv.entwurfHolenOderAnlegen(ws, deal, MENSCH, opts());
    const [roh] = await sql`select to_char(updated_at, 'US') as us from deal_calculation_versions where id = ${v.id}`;
    expect(roh.us).toMatch(/^\d{6}$/);
    await expect(kv.sperren(ws, deal, 1, MENSCH, {}, opts())).resolves.toMatchObject({ version: { status: "gesperrt" } });
  });

  // ─── I3 ────────────────────────────────────────────────────────────────

  it("I3: Paketpreis-Anpassung wirkt an jedem Tag als Differenz; Kundenwahl und Portal nutzen den Tagespreis", async () => {
    await kv.entwurfHolenOderAnlegen(ws, deal, MENSCH, opts());
    // Erst die Paketanpassung (+110 € zum Rechnerpreis 1.490), dann die Tage.
    await kv.uebersteuern(ws, deal, 1, { art: "paketpreis", key: "komfort", wert: { betrag: 1600 }, grund: "Dritter Helfer" }, MENSCH, opts());
    await kv.tageSetzen(ws, deal, 1, MENSCH, tageEingabe(FR), opts());
    const { version: v } = await kv.sperren(ws, deal, 1, MENSCH, {}, opts());
    expect(paketAmTag(v, FR, "komfort")).toBe(1600);
    expect(paketAmTag(v, SA, "komfort")).toBe(1700);
    expect(paketAmTag(v, SA, "basis")).toBe(1390);
    const tage = await sql`select offer_date::text as d, id, package_prices from quotation_date_offers where deal_record_id = ${deal} order by offer_date`;
    expect(tage.map((x) => x.package_prices)).toEqual([{ basis: 129000, komfort: 160000 }, { basis: 139000, komfort: 170000 }]);

    // Kunde wählt den Samstag: Komfort am Samstag mit Differenz.
    expect(await portal.selectDateOffer(token, { dateOfferId: tage[1].id, slotIndex: 0 }, ctx)).toEqual({ ok: true });
    expect(await quotation()).toMatchObject({ fixed_price: "1700.00", calculation_version_id: v.id });
    const c = (await portal.loadContextByToken(token))!;
    expect(c.kva?.totalCents).toBe(170000);
  });

  it("I3, Rennen: Paketpreis-Anpassung gegen Sperren mit Tagen; gesperrt wird nie ein Tag ohne die Differenz", async () => {
    await kv.entwurfHolenOderAnlegen(ws, deal, MENSCH, opts());
    await kv.tageSetzen(ws, deal, 1, MENSCH, tageEingabe(FR), opts());
    const t = tor();
    const langsam = opts({
      aktualisieren: async (id, patch) => {
        await t.warte();
        return speicherMod.dbVersionsSpeicher.aktualisieren(id, patch);
      },
    });
    const lauf = kv.uebersteuern(ws, deal, 1, { art: "paketpreis", key: "komfort", wert: { betrag: 1400 }, grund: "Stammkunde" }, MENSCH, langsam);
    await t.angekommen;
    const { version: v } = await kv.sperren(ws, deal, 1, MENSCH, {}, opts());
    t.frei();
    await lauf;
    // −90 € an beiden Tagen, im Terminangebot genauso.
    expect([paketAmTag(v, FR, "komfort"), paketAmTag(v, SA, "komfort")]).toEqual([1400, 1500]);
    const tage = await sql`select package_prices from quotation_date_offers where deal_record_id = ${deal} order by offer_date`;
    expect(tage.map((x) => x.package_prices.komfort)).toEqual([140000, 150000]);
  });

  it("I3: Untergrenze je Tag; Paketanpassung und „Tage anbieten“ lehnen ab, ohne etwas anzuhängen; ein eigener Tagespreis löst es", async () => {
    // Komfort am Samstag: Selbstkosten 1.100 €, Preis bei 30 % Marge 1.580 €.
    rechnerStand.komfortSelbstkostenSa = 1100;
    await kv.entwurfHolenOderAnlegen(ws, deal, MENSCH, opts());
    await kv.tageSetzen(ws, deal, 1, MENSCH, tageEingabe(FR), opts());
    const anzahl = (await version(1)).overrides.length;
    // 1.290 am Basistag (Grenze 1.280) geht, am Samstag 1.390 nicht.
    await expect(
      kv.uebersteuern(ws, deal, 1, { art: "paketpreis", key: "komfort", wert: { betrag: 1290 }, grund: "Rabatt" }, MENSCH, opts())
    ).rejects.toThrow("Der Paketpreis für komfort liegt am 21.11.2026 unter der Mindestmarge von 30 % (mindestens 1.580 €).");
    expect((await version(1)).overrides.length).toBe(anzahl);

    // Ohne Samstag geht die Anpassung; den Samstag danach anbieten lehnt „Tage anbieten“ ab.
    await kv.tageSetzen(ws, deal, 1, MENSCH, tageEingabe(FR, [FR]), opts());
    await kv.uebersteuern(ws, deal, 1, { art: "paketpreis", key: "komfort", wert: { betrag: 1290 }, grund: "Rabatt" }, MENSCH, opts());
    const mitAnpassung = (await version(1)).overrides.length;
    await expect(kv.tageSetzen(ws, deal, 1, MENSCH, tageEingabe(FR), opts())).rejects.toThrow("unter der Mindestmarge");
    expect((await version(1)).overrides.length).toBe(mitAnpassung);
    expect((await version(1)).dayPrices.map((d) => d.datum)).toEqual([FR]);

    // Mit eigenem Preis für Komfort am Samstag geht es.
    await kv.tageSetzen(ws, deal, 1, MENSCH, { ...tageEingabe(FR), uebersteuerungen: [{ datum: SA, paketSlug: "komfort", betrag: 1600, grund: "Samstag" }] }, opts());
    const { version: v } = await kv.sperren(ws, deal, 1, MENSCH, {}, opts());
    expect([paketAmTag(v, FR, "komfort"), paketAmTag(v, SA, "komfort")]).toEqual([1290, 1600]);
  });

  // ─── I1 ────────────────────────────────────────────────────────────────

  /** Gesperrte Version mit Paketen am Fr und Sa; Kunde hat Basis am Freitag. */
  async function gesperrtMitWahl() {
    await kv.entwurfHolenOderAnlegen(ws, deal, MENSCH, opts());
    await kv.tageSetzen(ws, deal, 1, MENSCH, tageEingabe(FR), opts());
    const { version: v } = await kv.sperren(ws, deal, 1, MENSCH, {}, opts());
    expect(await portal.selectDealPackageOptionForToken(token, { optionId: ids.basis }, ctx)).toEqual({ ok: true });
    const [fr] = await sql`select id from quotation_date_offers where deal_record_id = ${deal} and offer_date = ${FR}`;
    expect(await portal.selectDateOffer(token, { dateOfferId: fr.id, slotIndex: 0 }, ctx)).toEqual({ ok: true });
    expect(await quotation()).toMatchObject({ fixed_price: "1290.00", calculation_version_id: v.id });
    return v;
  }
  const formular = (eur: number, text: string) =>
    quotations.upsertQuotation(deal, {
      fixedPrice: eur.toFixed(2),
      isVariable: false,
      lineItems: [{ type: "other", description: text, quantity: 1, unitRate: eur.toFixed(2), sortOrder: 0 }],
    });

  it("I1: Speichern der aktuellen Wahl lässt den Bezug; anderer Text bei gleichem Betrag löst ihn", async () => {
    const v = await gesperrtMitWahl();
    await formular(1290, `Umzug basis ${FR}`);
    expect((await quotation()).calculation_version_id).toBe(v.id);
    await formular(1290, `Umzug basis ${FR} inkl. Klavier`);
    expect((await quotation()).calculation_version_id).toBeNull();
  });

  it("I1, Rennen: Kunde wählt Komfort, gleichzeitig speichert das Formular den alten Stand (Basis): Bezug gelöst", async () => {
    const v = await gesperrtMitWahl();
    // Die Kundenwahl hält die Angebots-Sperre, bis das Formular wartet; Postgres vergibt in dieser Reihenfolge.
    const halt = tor();
    const { db } = await import("@/db");
    const haelt = db.transaction(async (tx) => {
      await quotations.angebotSperren(tx, deal);
      await halt.warte();
    });
    await halt.angekommen;
    const wahl = portal.selectDealPackageOptionForToken(token, { optionId: ids.komfort }, ctx);
    await warteAufSperre(1);
    const form = formular(1290, `Umzug basis ${FR}`);
    await warteAufSperre(2);
    halt.frei();
    await haelt;
    expect(await wahl).toEqual({ ok: true });
    await form;
    // Die Quotation nennt Basis (Formular), das Portal rechnete Komfort: nicht mehr aus der Version.
    expect(await quotation()).toMatchObject({ fixed_price: "1290.00", calculation_version_id: null });
    expect(v.id).toBeTruthy();
  });

  async function warteAufSperre(n: number) {
    for (let i = 0; i < 300; i++) {
      const [{ c }] = await sql`select count(*)::int as c from pg_locks where locktype = 'advisory' and not granted`;
      if (c >= n) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`nicht ${n} Wartende`);
  }

  // ─── M1, M3 ─────────────────────────────────────────────────────────────

  it("M3: hat die Wahl des Kunden (Basis am Fr) in der neuen Version keinen Preis, sperrt nichts: Hinweis statt zero_price, Quotation unverändert", async () => {
    await gesperrtMitWahl();
    // Nächster Entwurf: Basis am Freitag ohne Rechnerpreis (z. B. nicht kalkulierbar).
    const ohneBasisFr = opts();
    ohneBasisFr.rechner = async (a) => {
      const e = rechnerAntwort(a);
      for (const t of e.tagespreise ?? []) if (t.datum === FR) t.paketpreise = t.paketpreise!.map((p) => (p.slug === "basis" ? { ...p, festpreis: null } : p));
      return { ok: true as const, ergebnis: e };
    };
    const { version: neu } = await kv.entwurfHolenOderAnlegen(ws, deal, MENSCH, ohneBasisFr);
    await expect(kv.sperren(ws, deal, neu.version, MENSCH, {}, ohneBasisFr)).rejects.toMatchObject({ code: "RECHNER_FEHLER" });
    expect((await version(neu.version)).status).toBe("entwurf");
    expect(await quotation()).toMatchObject({ fixed_price: "1290.00" });
  });

  it("M1: Tage ohne Paketpreise sind nicht sperrbar, wenn die Version Pakete hat", async () => {
    const ohnePaketeAmTag = opts();
    ohnePaketeAmTag.rechner = async (a) => {
      const e = rechnerAntwort(a);
      for (const t of e.tagespreise ?? []) if (t.datum === SA) t.paketpreise = null;
      return { ok: true as const, ergebnis: e };
    };
    await kv.entwurfHolenOderAnlegen(ws, deal, MENSCH, ohnePaketeAmTag);
    await kv.tageSetzen(ws, deal, 1, MENSCH, tageEingabe(FR), ohnePaketeAmTag);
    await expect(kv.sperren(ws, deal, 1, MENSCH, {}, ohnePaketeAmTag)).rejects.toMatchObject({
      code: "RECHNER_FEHLER",
      message: "Für den 21.11.2026 liefert der Rechner keine Paketpreise. Bitte den Tag entfernen oder neu rechnen.",
    });
  });
  it("M2: gewählte Option ohne Bindung an die Version: CRM und Portal nehmen dasselbe Paket (empfohlene gebundene)", async () => {
    await kv.entwurfHolenOderAnlegen(ws, deal, MENSCH, opts());
    await kv.tageSetzen(ws, deal, 1, MENSCH, tageEingabe(FR), opts());
    await kv.sperren(ws, deal, 1, MENSCH, {}, opts());
    // Eine Option von Hand dazu (ohne Version) und als Kundenwahl gesetzt.
    const frei = randomUUID();
    await sql`insert into quotation_package_options (id, workspace_id, deal_record_id, catalogue_slug, display_name, price_cents, is_recommended, sort_order)
      values (${frei}, ${ws}, ${deal}, 'premium', 'Premium', 250000, false, 2)`;
    await sql`update quotations set selected_package_option_id = ${frei}, selected_package_slug = 'premium' where deal_record_id = ${deal}`;
    const [sa] = await sql`select id from quotation_date_offers where deal_record_id = ${deal} and offer_date = ${SA}`;
    expect(await portal.selectDateOffer(token, { dateOfferId: sa.id, slotIndex: 0 }, ctx)).toEqual({ ok: true });
    // CRM: Komfort (empfohlen, gebunden) am Samstag.
    expect(await quotation()).toMatchObject({ fixed_price: "1590.00" });
    // Portal: derselbe Preis in Auftragsdetails und Preiskarte.
    const c = (await portal.loadContextByToken(token))!;
    expect(c.dealPackageOffers.options.find((o) => o.id === frei)?.gebunden).toBe(false);
    expect(c.kva?.totalCents).toBe(159000);
    const { angezeigterPreis } = await import("@openclaw-crm/customer-portal-core");
    expect(angezeigterPreis(c).cents).toBe(159000);
  });
});

import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Review I3 (KV-Montage 10.11.): eine Wahl je Möbel an einer gesperrten Version landet im
 * Entwurf und wird dort mit der vorhandenen Wahl zusammengeführt; sie setzt nie still andere
 * Möbel zurück, die gesperrte Version bleibt unverändert. Echter Dienst `uebersteuern` mit dem
 * DB-Speicher, Rechner und Lead als Attrappe. Läuft nur mit ANNAHME_TEST_DATABASE_URL.
 */
const url = process.env.ANNAHME_TEST_DATABASE_URL;

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.ANNAHME_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 3 });
  return { db: drizzle(client, { schema }) };
});
vi.mock("./activity-events", () => ({ emitEvent: async () => {} }));
vi.mock("./wartet", () => ({ aktualisiereWartet: async () => {}, aktualisiereWartetNachBesuch: async () => {} }));

import type { RechnerAnfrage } from "./rechner/eingabe";
import type { RechnerErgebnis } from "./rechner/client";
import type { Autor, VersionsOptionen } from "./kalkulation-versionen";

const MENSCH: Autor = { userId: null, quelle: "mensch" };
const lead = {
  von: "Hauptstr. 1, 71032 Böblingen", nach: "Bahnhofstr. 5, 70173 Stuttgart", etageVon: 2, etageNach: 0, zugangVon: null, zugangNach: null,
  umzugsdatum: "2026-11-29", wohnflaecheQm: null, zimmer: 3, tragestreckeVonM: null, tragestreckeNachM: null,
  halteverbot: false, packService: false, kartons: null, auftragsart: "umzug" as const,
  inventar: [
    { name: "Doppelbett", menge: 1, groessenklasse: null, volumenCbm: null, mitnehmen: true },
    { name: "Kleiderschrank", menge: 1, groessenklasse: null, volumenCbm: null, mitnehmen: true },
  ],
};

function rechnerAntwort(a: RechnerAnfrage): RechnerErgebnis {
  const zeilen = Array.isArray(a.positionen_freitext) ? a.positionen_freitext : [];
  return {
    montageJePosition: true,
    preis: { festpreis: 1490, selbstkosten: 800, rundungEur: 10, margeWirksamProzent: 40, nichtKalkulierbarGrund: null, margeVorschlag: { prozent: 40, gruende: [] } },
    kosten: { selbstkosten: 800, posten: [] },
    volumen: { nettoCbm: 20 },
    tarif: { id: "t1", version: 3, marke: "kottke" },
    schaetzung: null,
    positionen: zeilen.map((z) => ({ name: String(z.name), menge: 1, volumenCbm: 1, zerlegt: z.demontage !== "nein" })),
  } as RechnerErgebnis;
}

describe.skipIf(!url)("Wahl Demontage/Montage an gesperrter Version (DB, Review I3)", { timeout: 30_000 }, () => {
  let sql: postgres.Sql;
  let kv: typeof import("./kalkulation-versionen");
  let speicherMod: typeof import("./kalkulation-versionen-speicher");
  const ws = randomUUID();
  const dealObj = randomUUID();
  const deal = randomUUID();

  const opts = (): VersionsOptionen => ({
    speicher: speicherMod.dbVersionsSpeicher,
    ladeLead: async () => lead,
    rechner: async (a) => ({ ok: true as const, ergebnis: rechnerAntwort(a) }),
    melde: async () => ({ ok: true as const }),
    jetzt: () => new Date("2026-11-10T09:00:00Z"),
    nachher: () => {},
    hatPakete: async () => false,
    ladePaketHebel: async () => null,
    ladeCache: async () => null,
    nachSperren: async () => {},
    ladeSchalter: async () => ({ angebotAusKalkulation: false, tagespreise: false }),
    istKottke: async () => true,
    ladeBelegung: async () => ({ auftraege: [], kapazitaet: [] }),
    ladeWunschtermine: async () => [],
  });

  beforeAll(async () => {
    sql = postgres(url!, { max: 2 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Test', ${`t-${ws}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${dealObj}, ${ws}, 'deals', 'Deal', 'Deals')`;
    await sql`insert into records (id, object_id) values (${deal}, ${dealObj})`;
    kv = await import("./kalkulation-versionen");
    speicherMod = await import("./kalkulation-versionen-speicher");
  });

  afterAll(async () => {
    await sql`delete from workspaces where id = ${ws}`;
    await sql.end();
  });

  it("Wahl an v1 (gesperrt) landet in v2 und wird dort zusammengeführt; v1 bleibt", async () => {
    // v1 anlegen und sperren (direkt im Speicher, ohne Angebot).
    const v1 = await kv.entwurfHolenOderAnlegen(ws, deal, MENSCH, opts());
    await sql`update deal_calculation_versions set status = 'gesperrt', locked_at = now() where id = ${v1.version.id}`;
    const vorher = await sql`select overrides, rechner_request from deal_calculation_versions where id = ${v1.version.id}`;

    const grund = "Demontage/Montage je Möbel im Inventar gewählt";
    const erst = await kv.uebersteuern(ws, deal, 1, { art: "montage", key: "moebel", wert: { positionen: { doppelbett: { abbau: "customer", aufbau: "customer" } } }, grund }, MENSCH, opts());
    expect(erst.neu).toBe(true);
    expect(erst.version.version).toBe(2);

    // Nutzer schaut weiter auf die gesperrte v1 und wählt nur den Schrank.
    const zweit = await kv.uebersteuern(ws, deal, 1, { art: "montage", key: "moebel", wert: { positionen: { kleiderschrank: { abbau: "none", aufbau: "none" } } }, grund }, MENSCH, opts());
    expect(zweit.version.version).toBe(2);
    const wahl = kv.wirksamerWert(zweit.version.overrides, "montage", "moebel") as { positionen: Record<string, unknown> };
    expect(wahl.positionen).toEqual({
      doppelbett: { abbau: "customer", aufbau: "customer" },
      kleiderschrank: { abbau: "none", aufbau: "none" },
    });
    // Beide gehen an den Rechner: Bett beim Kunden, Schrank nicht zerlegt.
    expect(zweit.version.rechnerRequest?.positionen_freitext).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Doppelbett", abbau: "customer", aufbau: "customer" }),
        expect.objectContaining({ name: "Kleiderschrank", abbau: "none", aufbau: "none", demontage: "nein" }),
      ])
    );
    const nachher = await sql`select overrides, rechner_request, status from deal_calculation_versions where id = ${v1.version.id}`;
    expect(nachher[0].status).toBe("gesperrt");
    expect(nachher[0].overrides).toEqual(vorher[0].overrides);
    expect(nachher[0].rechner_request).toEqual(vorher[0].rechner_request);
  });
});

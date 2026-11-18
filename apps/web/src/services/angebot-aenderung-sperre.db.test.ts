import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * KI-Sperre „Angebot ändern“ über Instanzen hinweg (Review M7): Postgres-Advisory-Lock je Deal.
 * Eine zweite Verbindung (wie eine zweite Server-Instanz) sieht die Sperre. Läuft nur mit
 * ANNAHME_TEST_DATABASE_URL (Wegwerf-DB, nie Neon).
 */
const url = process.env.ANNAHME_TEST_DATABASE_URL;

describe.skipIf(!url)("kiSperreDb (DB)", () => {
  let fremd: postgres.Sql;
  let kiSperreDb: typeof import("./angebot-aenderung").kiSperreDb;
  const ws = randomUUID();
  const deal = randomUUID();
  const schluessel = `aa-ki:${ws}:${deal}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    fremd = postgres(url!, { max: 1 });
    ({ kiSperreDb } = await import("./angebot-aenderung"));
  });

  afterAll(async () => {
    await fremd?.end();
  });

  it("zweiter Aufruf ist sofort belegt, ohne zu warten; danach wieder frei", async () => {
    let weiter!: () => void;
    const haelt = new Promise<void>((r) => (weiter = r));
    let drin!: () => void;
    const istDrin = new Promise<void>((r) => (drin = r));
    const erste = kiSperreDb(ws, deal, async () => {
      drin();
      await haelt;
      return "erste";
    });
    await istDrin;

    const start = Date.now();
    const zweite = await kiSperreDb(ws, deal, async () => "zweite");
    expect(zweite).toEqual({ belegt: true });
    expect(Date.now() - start).toBeLessThan(2000);
    // Andere Instanz (eigene Verbindung): dieselbe Sperre ist belegt.
    const [{ frei }] = await fremd<{ frei: boolean }[]>`select pg_try_advisory_xact_lock(hashtext(${schluessel})) as frei`;
    expect(frei).toBe(false);
    // Anderer Deal: frei.
    expect(await kiSperreDb(ws, randomUUID(), async () => 1)).toEqual({ belegt: false, wert: 1 });

    weiter();
    expect(await erste).toEqual({ belegt: false, wert: "erste" });
    expect(await kiSperreDb(ws, deal, async () => "dritte")).toEqual({ belegt: false, wert: "dritte" });
  });

  it("ein Fehler in der Auswertung gibt die Sperre frei", async () => {
    await expect(kiSperreDb(ws, deal, async () => { throw new Error("KI kaputt"); })).rejects.toThrow("KI kaputt");
    expect(await kiSperreDb(ws, deal, async () => "danach")).toEqual({ belegt: false, wert: "danach" });
    // Nichts bleibt hängen: eine andere Verbindung bekommt die Sperre.
    const [{ frei }] = await fremd<{ frei: boolean }[]>`select pg_try_advisory_xact_lock(hashtext(${schluessel})) as frei`;
    expect(frei).toBe(true);
  });
});

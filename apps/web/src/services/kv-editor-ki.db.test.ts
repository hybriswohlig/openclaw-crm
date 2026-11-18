import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KV_CHAT_EVENT, type KvBasis, type KvChatBeitrag } from "@/lib/kv-editor";
import type { KvKiStand } from "./kv-editor-ki";

/**
 * KI-Chat des KV-Editors gegen eine echte Postgres-Datenbank (Plan Aufgabe 4b): Sperre über
 * Instanzen, Beiträge per Insert mit ID, Verlauf mit `uebernommen`. Läuft nur mit
 * KV_KI_TEST_DATABASE_URL (Wegwerf-DB mit Schema inkl. 0071, nie Neon). Keine echte KI.
 */
const url = process.env.KV_KI_TEST_DATABASE_URL;

const BASIS: KvBasis = {
  renderer: "crm",
  felder: [
    { schluessel: "bemerkungen:text:text", abschnitt: "bemerkungen", label: "Bemerkungen", art: "langtext", max: 2000, basis: "Klingel" },
  ],
};
const STAND: KvKiStand = { renderer: "crm", basis: BASIS, werte: { "bemerkungen:text:text": "Klingel" }, firma: "Ceylan", anrede: "sie" };

describe.skipIf(!url)("kv-editor-ki (DB)", () => {
  let sql: postgres.Sql;
  let fremd: postgres.Sql;
  let ki: typeof import("./kv-editor-ki");
  const ws = randomUUID();
  const obj = randomUUID();
  const deal = randomUUID();
  const user = randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    sql = postgres(url!, { max: 2 });
    fremd = postgres(url!, { max: 1 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'KV-KI', ${`t-${ws}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${obj}, ${ws}, 'deals', 'Deal', 'Deals')`;
    await sql`insert into records (id, object_id) values (${deal}, ${obj})`;
    ki = await import("./kv-editor-ki");
  });

  afterAll(async () => {
    await sql`delete from workspaces where id = ${ws}`;
    await sql.end();
    await fremd.end();
  });

  const anzahl = async () =>
    (await sql<{ n: number }[]>`select count(*)::int as n from activity_events where workspace_id = ${ws} and event_type = ${KV_CHAT_EVENT}`)[0].n;

  it("zweite Anfrage zum selben Deal: LAEUFT, sofort und ohne zu schreiben; danach wieder frei", async () => {
    let weiter!: () => void;
    const haelt = new Promise<void>((r) => (weiter = r));
    let drin!: () => void;
    const istDrin = new Promise<void>((r) => (drin = r));
    const erste = ki.kvChat(ws, deal, { standId: "st_1", text: "Erste" }, user, {
      stand: async () => STAND,
      ki: async () => {
        drin();
        await haelt;
        return { antwort: "Ok.", aenderungen: [{ schluessel: "bemerkungen:text:text", wert: "Klingel bei A" }] };
      },
    });
    await istDrin;

    const start = Date.now();
    await expect(
      ki.kvChat(ws, deal, { standId: "st_1", text: "Zweite" }, user, { stand: async () => STAND, ki: async () => ({ antwort: "x" }) })
    ).rejects.toMatchObject({ code: "LAEUFT", status: 409 });
    expect(Date.now() - start).toBeLessThan(2000);
    // Andere Instanz (eigene Verbindung) sieht dieselbe Sperre.
    const [{ frei }] = await fremd<{ frei: boolean }[]>`select pg_try_advisory_xact_lock(hashtext(${ki.kvKiSperrSchluessel(ws, deal)})) as frei`;
    expect(frei).toBe(false);
    expect(await anzahl()).toBe(0);

    weiter();
    const a = await erste;
    expect(a.vorschlaege.map((v) => v.wert)).toEqual(["Klingel bei A"]);
    expect(await anzahl()).toBe(2);

    // Frei nach dem Ende: dritte Anfrage läuft durch.
    await ki.kvChat(ws, deal, { standId: "st_1", text: "Dritte" }, user, { stand: async () => STAND, ki: async () => ({ antwort: "Nichts." }) });
    expect(await anzahl()).toBe(4);
  });

  it("Beiträge per Insert mit ID, still; Verlauf in Reihenfolge, uebernommen über kv_staende", async () => {
    const a = await ki.kvChat(ws, deal, { standId: "st_9", text: "Klingel ergänzen" }, user, {
      stand: async () => STAND,
      ki: async () => ({ antwort: "Vorschlag.", aenderungen: [{ schluessel: "bemerkungen:text:text", wert: "Klingel links" }] }),
    });
    const [ev] = await sql<{ event_type: string; record_id: string; object_slug: string; payload: Record<string, unknown>; actor_id: string | null }[]>`
      select event_type, record_id, object_slug, payload, actor_id from activity_events where id = ${a.nachrichtId}`;
    expect(ev).toMatchObject({ event_type: KV_CHAT_EVENT, record_id: deal, object_slug: "deals", actor_id: null });
    expect(ev.payload).toMatchObject({ silent: true, rolle: "ki", standId: "st_9", von: user, text: "Vorschlag." });
    expect((ev.payload.vorschlaege as unknown[]).length).toBe(1);

    let verlauf: KvChatBeitrag[] = await ki.kvChatVerlauf(ws, deal);
    const letzte = verlauf.slice(-2);
    expect(letzte.map((b) => [b.rolle, b.text, b.uebernommen])).toEqual([
      ["nutzer", "Klingel ergänzen", false],
      ["ki", "Vorschlag.", false],
    ]);
    expect(letzte[1].nachrichtId).toBe(a.nachrichtId);
    expect(letzte[1].vorschlaege).toEqual(a.vorschlaege);
    expect(letzte[0].vorschlaege).toBeUndefined();
    expect(verlauf.map((b) => b.am)).toEqual([...verlauf.map((b) => b.am)].sort());

    // Übernommen (Aufgabe 3 schreibt ki_nachricht_id beim Speichern).
    await sql`insert into kv_staende (id, workspace_id, deal_record_id, nummer, renderer, grundlage, quelle, status, ki_nachricht_id)
      values (${randomUUID()}, ${ws}, ${deal}, 1, 'crm', ${sql.json({ copy: {} })}, 'ki', 'fertig', ${a.nachrichtId})`;
    verlauf = await ki.kvChatVerlauf(ws, deal);
    expect(verlauf.find((b) => b.nachrichtId === a.nachrichtId)?.uebernommen).toBe(true);
    expect(verlauf.filter((b) => b.uebernommen)).toHaveLength(1);

    // Fremder Workspace sieht nichts.
    expect(await ki.kvChatVerlauf(randomUUID(), deal)).toEqual([]);
  });

  it("KI-Fehler: nichts gespeichert, Sperre frei", async () => {
    const vorher = await anzahl();
    await expect(
      ki.kvChat(ws, deal, { standId: "st_1", text: "Hallo" }, user, { stand: async () => STAND, ki: async () => null })
    ).rejects.toMatchObject({ code: "KI_FEHLER" });
    await expect(
      ki.kvChat(ws, deal, { standId: "st_1", text: "Hallo" }, user, { stand: async () => STAND, ki: () => new Promise(() => {}), zeitgrenzeMs: 50 })
    ).rejects.toMatchObject({ code: "KI_FEHLER" });
    expect(await anzahl()).toBe(vorher);
    const [{ frei }] = await fremd<{ frei: boolean }[]>`select pg_try_advisory_xact_lock(hashtext(${ki.kvKiSperrSchluessel(ws, deal)})) as frei`;
    expect(frei).toBe(true);
  });
});

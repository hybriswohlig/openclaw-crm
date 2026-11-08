import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.BEWERTUNG_TEST_DATABASE_URL;

const held = vi.hoisted(() => ({
  client: null as { end: (opts?: { timeout?: number }) => Promise<void> } | null,
}));

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.BEWERTUNG_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 1 });
  held.client = client;
  return { db: drizzle(client, { schema }) };
});

import { ladeBewertungen } from "./bewertungen-liste";

async function clientSchliessen(): Promise<void> {
  const client = held.client;
  held.client = null;
  await client?.end({ timeout: 5 });
}

afterAll(async () => {
  await clientSchliessen();
});

const jetzt = new Date("2026-11-08T12:00:00.000Z");
const anker = new Date("2026-11-06T12:00:00.000Z");
const fenster = new Date("2026-11-09T08:00:00.000Z");
const seit = new Date("2026-11-01T00:00:00.000Z");
const altStufe = new Date(jetzt.getTime() - 181 * 24 * 60 * 60 * 1000);
const google = "https://g.page/r/kottke/review";

describe.skipIf(!url)("ladeBewertungen gegen Postgres", () => {
  let sql: postgres.Sql | undefined;
  const ws = randomUUID();
  const fremd = randomUUID();
  const leer = randomUUID();
  const id: Record<string, string> = {};

  beforeAll(async () => {
    sql = postgres(url!, { max: 1 });
    const s = sql;
    const neu = (key: string) => {
      id[key] = randomUUID();
      return id[key]!;
    };

    await s`insert into workspaces (id, name, slug) values (${ws}, 'Bewertungen', ${`b-${ws}`})`;
    await s`insert into workspaces (id, name, slug) values (${fremd}, 'Fremd', ${`f-${fremd}`})`;

    const deals = neu("deals");
    const people = neu("people");
    const firmen = neu("firmen");
    await s`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${deals}, ${ws}, 'deals', 'Deal', 'Deals')`;
    await s`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${people}, ${ws}, 'people', 'Person', 'Personen')`;
    await s`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${firmen}, ${ws}, 'operating_companies', 'Firma', 'Firmen')`;

    async function attr(objectId: string, slug: string, type: string) {
      const a = neu(`a:${objectId}:${slug}`);
      await s`insert into attributes (id, object_id, slug, title, type) values (${a}, ${objectId}, ${slug}, ${slug}, ${type}::text::attribute_type)`;
      return a;
    }
    const nameD = await attr(deals, "name", "text");
    const stage = await attr(deals, "stage", "status");
    const status = await attr(deals, "review_request_status", "status");
    const dnc = await attr(deals, "do_not_contact_review", "checkbox");
    const firmaA = await attr(deals, "operating_company", "record_reference");
    const leute = await attr(deals, "associated_people", "record_reference");
    const sent = await attr(deals, "review_request_sent_at", "timestamp");
    const nameP = await attr(people, "name", "text");
    const kontakt = await attr(people, "kontaktart", "select");
    const nameF = await attr(firmen, "name", "text");
    const paid = neu("st:paid");
    const quoted = neu("st:quoted");
    await s`insert into statuses (id, attribute_id, title, stage_category) values (${paid}, ${stage}, 'Bezahlt', 'paid')`;
    await s`insert into statuses (id, attribute_id, title, stage_category) values (${quoted}, ${stage}, 'Angebot', 'quoted')`;

    async function datensatz(objectId: string, key: string, geloescht = false) {
      const r = neu(key);
      await s`insert into records (id, object_id, deleted_at) values (${r}, ${objectId}, ${geloescht ? new Date("2026-10-01T00:00:00.000Z") : null})`;
      return r;
    }
    async function textWert(record: string, attribute: string, wert: string, sort = 0) {
      await s`insert into record_values (id, record_id, attribute_id, text_value, sort_order) values (${randomUUID()}, ${record}, ${attribute}, ${wert}, ${sort})`;
    }
    async function ref(record: string, attribute: string, ziel: string, sort = 0) {
      await s`insert into record_values (id, record_id, attribute_id, referenced_record_id, sort_order) values (${randomUUID()}, ${record}, ${attribute}, ${ziel}, ${sort})`;
    }

    const ocK = await datensatz(firmen, "ocK");
    const ocC = await datensatz(firmen, "ocC");
    const ocN = await datensatz(firmen, "ocN");
    await textWert(ocK, nameF, "Kottke Umzüge");
    await textWert(ocC, nameF, "Ceylan Transporte");
    await textWert(ocN, nameF, "Nord GmbH");
    await s`insert into company_settings (operating_company_record_id, workspace_id, bewertung_modus, bewertung_modus_seit) values (${ocK}, ${ws}, 'entwurf', ${seit})`;
    await s`insert into operating_company_portal_settings (operating_company_record_id, workspace_id, google_review_url) values (${ocK}, ${ws}, ${google})`;
    await s`insert into operating_company_portal_settings (operating_company_record_id, workspace_id, google_review_url) values (${ocC}, ${ws}, 'notaurl')`;

    const person = await datensatz(people, "person");
    const weg = await datensatz(people, "weg", true);
    await textWert(person, nameP, "Anna Berger");
    await textWert(weg, nameP, "Weg");
    await textWert(person, kontakt, "lead_kunde");

    async function deal(key: string, opts: { firma?: string; stage?: string; entered?: Date | null; bezahlt?: Date | null; nummer?: string }) {
      const r = await datensatz(deals, key);
      await textWert(r, nameD, key);
      if (opts.firma) await ref(r, firmaA, opts.firma);
      if (opts.stage) await textWert(r, stage, opts.stage);
      await ref(r, leute, weg, 0);
      await ref(r, leute, person, 1);
      if (opts.entered || opts.bezahlt) {
        await s`insert into deal_workflow_state (record_id, stage_entered_at, bezahlt_am) values (${r}, ${opts.entered ?? null}, ${opts.bezahlt ?? null})`;
      }
      if (opts.nummer) {
        const seq = Number(opts.nummer.split("-")[1]);
        await s`insert into deal_numbers (id, workspace_id, deal_record_id, year, sequence, deal_number) values (${randomUUID()}, ${ws}, ${r}, 2026, ${seq}, ${opts.nummer})`;
      }
      return r;
    }

    const kuerzlich = new Date("2026-11-01T12:00:00.000Z");
    await deal("freigabe", { firma: ocK, stage: paid, entered: kuerzlich });
    await deal("vorgemerkt", { firma: ocK, stage: paid, entered: kuerzlich });
    await deal("faellig", { firma: ocK, stage: paid, entered: kuerzlich, bezahlt: anker, nummer: "2026-014" });
    await deal("angefragt", { firma: ocC, stage: paid, entered: kuerzlich });
    await deal("geklickt", { firma: ocK });
    await deal("gesperrt", { firma: ocK });
    await deal("altsperre", { firma: ocK, stage: paid, entered: kuerzlich });
    await deal("ausserhalb", { firma: ocK, stage: quoted, entered: kuerzlich });
    await deal("zualt", { firma: ocK, stage: paid, entered: altStufe, bezahlt: anker });

    const geloescht = neu("geloescht");
    await s`insert into records (id, object_id, deleted_at) values (${geloescht}, ${deals}, ${new Date("2026-10-01T00:00:00.000Z")})`;

    await s`insert into record_values (id, record_id, attribute_id, boolean_value, created_at) values (${randomUUID()}, ${id.altsperre}, ${dnc}, true, ${new Date("2026-01-15T00:00:00.000Z")})`;
    await s`insert into record_values (id, record_id, attribute_id, timestamp_value) values (${randomUUID()}, ${id.angefragt}, ${sent}, ${new Date("2026-11-07T10:00:00.000Z")})`;

    async function token(dealKey: string, zustand: string, quelle: string, clicked: Date | null, created: Date) {
      await s`insert into review_tokens (token, workspace_id, deal_record_id, destination_url, created_at, clicked_at, zustand, quelle) values (${neu(`t:${dealKey}:${created.getTime()}`)}, ${ws}, ${id[dealKey]!}, ${google}, ${created}, ${clicked}, ${zustand}, ${quelle})`;
    }
    await token("angefragt", "gesendet", "hand", null, new Date("2026-11-07T10:00:00.000Z"));
    await token("geklickt", "gesendet", "hand", null, new Date("2026-11-01T10:00:00.000Z"));
    await token("geklickt", "gesendet", "automatik", new Date("2026-11-07T15:00:00.000Z"), new Date("2026-11-07T11:00:00.000Z"));
    await token("gesperrt", "unklar", "alt", null, new Date("2026-11-02T10:00:00.000Z"));
    await token("geloescht", "gesendet", "hand", null, new Date("2026-11-02T10:00:00.000Z"));

    async function vorm(dealKey: string, art: string) {
      await s`insert into review_vormerkungen (id, workspace_id, deal_record_id, operating_company_record_id, art, status, faellig_ab, frist_bis) values (${neu(`v:${dealKey}`)}, ${ws}, ${id[dealKey]!}, ${ocK}, ${art}, 'offen', ${fenster}, ${new Date("2026-11-20T08:00:00.000Z")})`;
    }
    await vorm("freigabe", "entwurf");
    await vorm("vorgemerkt", "auto");

    const fremdObj = neu("fremdDeals");
    const fremdDeal = neu("fremdDeal");
    await s`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${fremdObj}, ${fremd}, 'deals', 'Deal', 'Deals')`;
    await s`insert into records (id, object_id) values (${fremdDeal}, ${fremdObj})`;
    await s`insert into review_tokens (token, workspace_id, deal_record_id, destination_url, zustand, quelle) values (${neu("fremdToken")}, ${fremd}, ${fremdDeal}, ${google}, 'gesendet', 'hand')`;
  });

  afterAll(async () => {
    if (sql) {
      await sql`delete from workspaces where id in (${ws}, ${fremd})`;
      await sql.end({ timeout: 5 });
    }
    await clientSchliessen();
  });

  it("ordnet jede Liste zu, zählt Altsperren und lässt fremde Workspaces leer", async () => {
    const a = await ladeBewertungen(ws, {}, jetzt);
    const zeile = (key: string) => a.zeilen.find((z) => z.dealId === id[key]);
    expect(zeile("freigabe")).toMatchObject({ liste: "freigabe", quelle: "entwurf", vormerkungId: id["v:freigabe"], firma: { id: id.ocK, marke: "kottke" }, kunde: { name: "Anna Berger" } });
    expect(zeile("freigabe")?.faelligAb).toBe(fenster.toISOString());
    expect(zeile("vorgemerkt")).toMatchObject({ liste: "vorgemerkt", quelle: "auto", faelligAb: fenster.toISOString() });
    expect(zeile("faellig")).toMatchObject({
      liste: "faellig",
      dealNummer: "2026-014",
      grund: null,
      faelligAb: new Date(anker.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      kunde: { personId: id.person, name: "Anna Berger" },
    });
    expect(zeile("angefragt")).toMatchObject({
      liste: "angefragt",
      quelle: "hand",
      angefragtAm: new Date("2026-11-07T10:00:00.000Z").toISOString(),
      firma: { id: id.ocC, marke: "ceylan" },
      tokenFreigebbar: false,
    });
    expect(zeile("geklickt")).toMatchObject({
      liste: "geklickt",
      quelle: "automatik",
      geklicktAm: new Date("2026-11-07T15:00:00.000Z").toISOString(),
    });
    expect(zeile("gesperrt")).toMatchObject({ liste: "gesperrt", grund: "VERSAND_UNKLAR", tokenFreigebbar: true, quelle: "alt" });
    expect(zeile("altsperre")).toBeUndefined();
    expect(zeile("ausserhalb")).toBeUndefined();
    expect(zeile("zualt")).toBeUndefined();
    expect(a.zeilen.some((z) => z.dealId === id.geloescht || z.dealId === id.fremdDeal)).toBe(false);
    expect(a.altsperren).toBe(1);
    expect(a.zaehler).toEqual({ freigabe: 1, vorgemerkt: 1, faellig: 1, angefragt: 1, geklickt: 1, gesperrt: 1 });
    expect(JSON.stringify(a)).not.toContain("click_ip");
    expect(JSON.stringify(a)).not.toContain("click_user_agent");

    const kottke = a.firmen.find((f) => f.id === id.ocK);
    const ceylan = a.firmen.find((f) => f.id === id.ocC);
    const nord = a.firmen.find((f) => f.id === id.ocN);
    expect(kottke).toMatchObject({ modus: "entwurf", modusSeit: seit.toISOString(), googleLink: true, marke: "kottke" });
    expect(ceylan).toMatchObject({ modus: "aus", modusSeit: null, googleLink: false, marke: "ceylan" });
    expect(nord).toMatchObject({ modus: "aus", modusSeit: null, googleLink: false, marke: null });

    const nurKottke = await ladeBewertungen(ws, { firmaId: id.ocK }, jetzt);
    expect(nurKottke.zeilen.map((z) => z.dealId).sort()).toEqual(
      [id.freigabe, id.vorgemerkt, id.faellig, id.geklickt, id.gesperrt].sort()
    );
    expect(nurKottke.zaehler.angefragt).toBe(0);
    expect(nurKottke.altsperren).toBe(1);
    expect(nurKottke.firmen).toHaveLength(3);

    const nurFaellig = await ladeBewertungen(ws, { firmaId: id.ocK, liste: "faellig" }, jetzt);
    expect(nurFaellig.zeilen.map((z) => z.dealId)).toEqual([id.faellig]);
    expect(nurFaellig.zaehler.freigabe).toBe(1);
    expect(nurFaellig.zaehler.faellig).toBe(1);

    const nurCeylan = await ladeBewertungen(ws, { firmaId: id.ocC }, jetzt);
    expect(nurCeylan.zeilen.map((z) => z.dealId)).toEqual([id.angefragt]);
    expect(nurCeylan.altsperren).toBe(0);

    const andere = await ladeBewertungen(fremd, {}, jetzt);
    expect(andere.zeilen.map((z) => z.dealId)).toEqual([id.fremdDeal]);
    expect(andere.altsperren).toBe(0);
    expect(andere.firmen).toEqual([]);
    expect(andere.zeilen.some((z) => z.dealId === id.faellig)).toBe(false);

    const nichts = await ladeBewertungen(leer, {}, jetzt);
    expect(nichts.zeilen).toEqual([]);
    expect(nichts.firmen).toEqual([]);
    expect(nichts.altsperren).toBe(0);
    expect(nichts.zaehler).toEqual({ freigabe: 0, vorgemerkt: 0, faellig: 0, angefragt: 0, geklickt: 0, gesperrt: 0 });
  });
});

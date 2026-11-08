import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Gleichzeitiges Anlegen und die Firma-Prüfung gegen eine Wegwerf-Datenbank.
 * Läuft nur mit LEAD_ANLEGEN_TEST_DATABASE_URL.
 */
const url = process.env.LEAD_ANLEGEN_TEST_DATABASE_URL;

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.LEAD_ANLEGEN_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 5 });
  return { db: drizzle(client, { schema }), testClient: client };
});

const nummer = vi.hoisted(() => ({ fehler: false }));
vi.mock("@/services/financial", async (orig) => {
  const echt = await orig<typeof import("@/services/financial")>();
  return {
    ...echt,
    assignDealNumber: async (ws: string, deal: string) => {
      if (nummer.fehler) throw new Error("nummernkreis weg");
      return echt.assignDealNumber(ws, deal);
    },
  };
});

describe.skipIf(!url)("neuenLeadAnlegen", { timeout: 20_000 }, () => {
  let sql: postgres.Sql;
  let anlegen: typeof import("./lead-anlegen").neuenLeadAnlegen;
  const ws = randomUUID();
  const wsFremd = randomUUID();
  const people = randomUUID();
  const deals = randomUUID();
  const firmen = randomUUID();
  const firmenFremd = randomUUID();
  const attrName = randomUUID();
  const attrPhone = randomUUID();
  const attrEmail = randomUUID();
  const attrDealName = randomUUID();
  const attrStage = randomUUID();
  const attrPeople = randomUUID();
  const attrQuelle = randomUUID();
  const attrEingang = randomUUID();
  const attrFirma = randomUUID();
  const attrMove = randomUUID();
  const stufe = randomUUID();
  const option = randomUUID();
  const firma = randomUUID();
  const firmaFremd = randomUUID();

  const eingabe = {
    name: "Ada Lovelace",
    telefon: "0151 5905 8963",
    email: "ada@example.com",
    firmaId: firma,
    quelle: "WhatsApp",
    umzugsdatum: "2026-12-01",
    personWahl: null,
  };

  beforeAll(async () => {
    sql = postgres(url!, { max: 1 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Test', ${`t-${ws}`}), (${wsFremd}, 'Fremd', ${`f-${wsFremd}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values
      (${people}, ${ws}, 'people', 'Person', 'Personen'),
      (${deals}, ${ws}, 'deals', 'Lead', 'Leads'),
      (${firmen}, ${ws}, 'operating_companies', 'Firma', 'Firmen'),
      (${firmenFremd}, ${wsFremd}, 'operating_companies', 'Firma', 'Firmen')`;
    await sql`insert into attributes (id, object_id, slug, title, type) values
      (${attrName}, ${people}, 'name', 'Name', 'personal_name'),
      (${attrPhone}, ${people}, 'phone_numbers', 'Telefon', 'phone_number'),
      (${attrEmail}, ${people}, 'email_addresses', 'E-Mail', 'email_address'),
      (${attrDealName}, ${deals}, 'name', 'Name', 'text'),
      (${attrStage}, ${deals}, 'stage', 'Stufe', 'status'),
      (${attrPeople}, ${deals}, 'associated_people', 'Person', 'record_reference'),
      (${attrQuelle}, ${deals}, 'source_channel', 'Quelle', 'select'),
      (${attrEingang}, ${deals}, 'source_received_at', 'Eingegangen', 'timestamp'),
      (${attrFirma}, ${deals}, 'operating_company', 'Firma', 'record_reference'),
      (${attrMove}, ${deals}, 'move_date', 'Umzug', 'date')`;
    await sql`insert into statuses (id, attribute_id, title, is_active, stage_category) values (${stufe}, ${attrStage}, 'Neue Anfrage', true, 'open_new')`;
    await sql`insert into select_options (id, attribute_id, title) values (${option}, ${attrQuelle}, 'WhatsApp')`;
    await sql`insert into records (id, object_id) values (${firma}, ${firmen}), (${firmaFremd}, ${firmenFremd})`;
    anlegen = (await import("./lead-anlegen")).neuenLeadAnlegen;
  });

  afterAll(async () => {
    await sql`delete from workspaces where id in (${ws}, ${wsFremd})`;
    await sql.end();
    // Den Pool des gemockten `@/db` schließen, sonst bleiben seine Verbindungen offen.
    const gemockt = (await import("@/db")) as unknown as { testClient: postgres.Sql };
    await gemockt.testClient.end();
  });

  it("Firma aus einem anderen Workspace wird abgelehnt", async () => {
    const fremd = await anlegen(ws, { ...eingabe, firmaId: firmaFremd, telefon: null }, null);
    expect(fremd).toEqual({ ok: false, code: "FIRMA" });
  });

  it("zwei gleichzeitige Anfragen mit derselben neuen Nummer ergeben eine Person und einen Lead", async () => {
    const [a, b] = await Promise.all([anlegen(ws, eingabe, null), anlegen(ws, eingabe, null)]);
    const ok = [a, b].filter((r) => r.ok);
    const rueck = [a, b].filter((r) => !r.ok && r.code === "RUECKFRAGE");
    expect(ok).toHaveLength(1);
    expect(rueck).toHaveLength(1);
    const angelegt = ok[0];
    const frage = rueck[0];
    if (!angelegt.ok || frage.ok || frage.code !== "RUECKFRAGE") throw new Error("unerwartet");
    expect(frage.treffer.some((karte) => karte.id === angelegt.personRecordId)).toBe(true);

    const personen = await sql`select id from records where object_id = ${people}`;
    const leads = await sql`select id from records where object_id = ${deals}`;
    expect(personen).toHaveLength(1);
    expect(leads).toHaveLength(1);
    expect(personen[0].id).toBe(angelegt.personRecordId);
    expect(leads[0].id).toBe(angelegt.dealRecordId);

    const nummern = await sql`select deal_number from deal_numbers where deal_record_id = ${angelegt.dealRecordId}`;
    expect(nummern).toHaveLength(1);
    expect(nummern[0].deal_number).toMatch(/^\d{4}-\d{3}$/);

    const stufeWert = await sql`select text_value from record_values where record_id = ${angelegt.dealRecordId} and attribute_id = ${attrStage}`;
    expect(stufeWert[0].text_value).toBe(stufe);
    const personWert = await sql`select referenced_record_id from record_values where record_id = ${angelegt.dealRecordId} and attribute_id = ${attrPeople}`;
    expect(personWert[0].referenced_record_id).toBe(angelegt.personRecordId);
    const firmaWert = await sql`select referenced_record_id from record_values where record_id = ${angelegt.dealRecordId} and attribute_id = ${attrFirma}`;
    expect(firmaWert[0].referenced_record_id).toBe(firma);
    const quelleWert = await sql`select text_value from record_values where record_id = ${angelegt.dealRecordId} and attribute_id = ${attrQuelle}`;
    expect(quelleWert[0].text_value).toBe(option);
    const umzug = await sql`select date_value::text as d from record_values where record_id = ${angelegt.dealRecordId} and attribute_id = ${attrMove}`;
    expect(umzug[0].d).toBe("2026-12-01");
    const eingang = await sql`select timestamp_value from record_values where record_id = ${angelegt.dealRecordId} and attribute_id = ${attrEingang}`;
    expect(eingang[0].timestamp_value).toBeTruthy();

    const telefon = await sql`select text_value from record_values where record_id = ${angelegt.personRecordId} and attribute_id = ${attrPhone}`;
    expect(telefon[0].text_value).toBe("+4915159058963");
    const mail = await sql`select text_value from record_values where record_id = ${angelegt.personRecordId} and attribute_id = ${attrEmail}`;
    expect(mail[0].text_value).toBe("ada@example.com");
    const kennung = await sql`select kind, value_canonical, source, trust from person_identifiers where person_record_id = ${angelegt.personRecordId}`;
    expect(kennung).toEqual([{ kind: "phone", value_canonical: "+4915159058963", source: "operator", trust: "claimed" }]);
  });

  it("bestehend übernimmt die schon angelegte Person", async () => {
    const [person] = await sql`select id from records where object_id = ${people}`;
    const nochmal = await anlegen(ws, { ...eingabe, personWahl: { art: "bestehend", personId: person.id } }, null);
    expect(nochmal.ok).toBe(true);
    if (!nochmal.ok) return;
    expect(nochmal.personRecordId).toBe(person.id);
    expect((await sql`select count(*)::int as n from records where object_id = ${people}`)[0].n).toBe(1);
    expect((await sql`select count(*)::int as n from records where object_id = ${deals}`)[0].n).toBe(2);
    const verknuepft = await sql`select referenced_record_id from record_values where record_id = ${nochmal.dealRecordId} and attribute_id = ${attrPeople}`;
    expect(verknuepft[0].referenced_record_id).toBe(person.id);
  });

  it("„Neue Person“ trotz Treffer legt eine zweite Person an, die Nummer nur als Feld", async () => {
    const neu = await anlegen(ws, { ...eingabe, name: "Bert Beispiel", personWahl: { art: "neu" } }, null);
    expect(neu.ok).toBe(true);
    if (!neu.ok) return;
    expect((await sql`select count(*)::int as n from records where object_id = ${people}`)[0].n).toBe(2);
    const telefon = await sql`select text_value from record_values where record_id = ${neu.personRecordId} and attribute_id = ${attrPhone}`;
    expect(telefon[0].text_value).toBe("+4915159058963");
    const kennung = await sql`select id from person_identifiers where person_record_id = ${neu.personRecordId}`;
    expect(kennung).toHaveLength(0);
    // Danach kennt die Nummer beide Personen; ohne Wahl fragt die Route wieder nach.
    const ohneWahl = await anlegen(ws, eingabe, null);
    expect(ohneWahl.ok).toBe(false);
    if (ohneWahl.ok || ohneWahl.code !== "RUECKFRAGE") throw new Error("unerwartet");
    expect(ohneWahl.treffer.map((t) => t.id).sort()).toEqual(
      [neu.personRecordId, (await sql`select person_record_id from person_identifiers limit 1`)[0].person_record_id].sort()
    );
  });

  it("scheitert die Dealnummer nach dem Commit, gilt der Lead trotzdem als angelegt (Review M5)", async () => {
    nummer.fehler = true;
    const fehler = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await anlegen(ws, { ...eingabe, telefon: null, email: "ohne-nummer@example.com", personWahl: null }, null);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect((await sql`select id from records where id = ${r.dealRecordId}`)).toHaveLength(1);
      expect((await sql`select id from deal_numbers where deal_record_id = ${r.dealRecordId}`)).toHaveLength(0);
      expect(fehler).toHaveBeenCalledWith("[neuer-lead] Dealnummer fehlt", r.dealRecordId, "nummernkreis weg");
    } finally {
      nummer.fehler = false;
      fehler.mockRestore();
    }
  });
});

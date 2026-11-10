import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Kunde und Adressen (Akte, Vorprüfung) gegen eine echte Postgres-DB
 * (ANNAHME_TEST_DATABASE_URL): Viktoria-Lage nachbauen, Auszug ergänzen, danach
 * hat der VPS-Auftrag eine Kundenanschrift. Person anlegen, Person ändern,
 * Mandantentrennung, nichts wird geleert.
 */
const url = process.env.ANNAHME_TEST_DATABASE_URL;

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  return { db: drizzle(pg(process.env.ANNAHME_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 4 }), { schema }) };
});
const angestossen = vi.hoisted(() => vi.fn());
vi.mock("@/services/rechner/ausloeser", () => ({ kalkulationAnstossen: angestossen, dealReferenz: () => null }));

describe.skipIf(!url)("Kunde und Adressen (DB)", { timeout: 30_000 }, () => {
  let sql: postgres.Sql;
  let dienst: typeof import("./deal-kunde");
  let docData: typeof import("@/lib/deal-doc-data");
  const ws = randomUUID();
  const fremd = randomUUID();
  const obj = { deals: randomUUID(), people: randomUUID(), fremdDeals: randomUUID() };
  const deal = { viktoria: randomUUID(), ohnePerson: randomUUID() };
  const person = randomUUID();
  const attr: Record<string, string> = {};

  async function attribut(objekt: string, slug: string, type: string, multi = false) {
    const id = randomUUID();
    attr[`${objekt}.${slug}`] = id;
    await sql`insert into attributes (id, object_id, slug, title, type, is_multiselect) values (${id}, ${objekt}, ${slug}, ${slug}, ${type}::text::attribute_type, ${multi})`;
  }

  beforeAll(async () => {
    sql = postgres(url!, { max: 2 });
    for (const w of [ws, fremd]) await sql`insert into workspaces (id, name, slug) values (${w}, 'Test', ${`t-${w}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values
      (${obj.deals}, ${ws}, 'deals', 'Deal', 'Deals'), (${obj.people}, ${ws}, 'people', 'Person', 'Personen'),
      (${obj.fremdDeals}, ${fremd}, 'deals', 'Deal', 'Deals')`;
    await attribut(obj.deals, "name", "text");
    await attribut(obj.deals, "move_from_address", "location");
    await attribut(obj.deals, "move_to_address", "location");
    await attribut(obj.deals, "move_date", "date");
    await attribut(obj.deals, "associated_people", "record_reference", true);
    await attribut(obj.people, "name", "personal_name");
    await attribut(obj.people, "phone_numbers", "phone_number", true);
    await attribut(obj.people, "email_addresses", "email_address", true);
    await sql`insert into records (id, object_id) values (${deal.viktoria}, ${obj.deals}), (${deal.ohnePerson}, ${obj.deals}), (${person}, ${obj.people})`;
    const wert = (rec: string, a: string, spalte: "text_value" | "json_value" | "referenced_record_id" | "date_value", v: unknown) =>
      sql`insert into record_values (id, record_id, attribute_id, ${sql(spalte)}) values (${randomUUID()}, ${rec}, ${attr[a]}, ${spalte === "json_value" ? sql.json(v as never) : (v as string)})`;
    // Viktoria: Person verknüpft, Einzug nur mit PLZ, kein Auszug (wie nach Plan 15).
    await wert(deal.viktoria, `${obj.deals}.name`, "text_value", "Viktoria");
    await wert(deal.viktoria, `${obj.deals}.move_to_address`, "json_value", { line1: "71032 Böblingen" });
    await wert(deal.viktoria, `${obj.deals}.move_date`, "date_value", "2026-11-28");
    await wert(deal.viktoria, `${obj.deals}.associated_people`, "referenced_record_id", person);
    await wert(person, `${obj.people}.name`, "json_value", { firstName: "Viktoria", lastName: "", fullName: "Viktoria" });
    await wert(person, `${obj.people}.phone_numbers`, "text_value", "0171 2345678");
    await wert(deal.ohnePerson, `${obj.deals}.name`, "text_value", "Familie Kraus — Calw → Nagold");
    dienst = await import("./deal-kunde");
    docData = await import("@/lib/deal-doc-data");
  });

  afterAll(async () => {
    await sql`delete from activity_events where workspace_id in (${ws}, ${fremd})`;
    await sql`delete from person_identifiers where workspace_id in (${ws}, ${fremd})`;
    await sql`delete from record_values where record_id in (select r.id from records r join objects o on o.id = r.object_id where o.workspace_id in (${ws}, ${fremd}))`;
    await sql`delete from records where object_id in (select id from objects where workspace_id in (${ws}, ${fremd}))`;
    await sql`delete from attributes where object_id in (select id from objects where workspace_id in (${ws}, ${fremd}))`;
    await sql`delete from objects where workspace_id in (${ws}, ${fremd})`;
    await sql`delete from workspaces where id in (${ws}, ${fremd})`;
    await sql.end();
  });

  it("lädt die Viktoria-Lage: Person, Telefon, Einzug nur PLZ und Ort, kein Auszug", async () => {
    const k = await dienst.ladeKunde(ws, deal.viktoria);
    expect(k).toEqual({
      personId: person,
      name: "Viktoria",
      nameAusPerson: true,
      telefon: "0171 2345678",
      email: null,
      auszug: null,
      einzug: { strasse: "", plz: "71032", ort: "Böblingen" },
      datum: "2026-11-28",
    });
  });

  it("anderer Workspace sieht den Deal nicht und kann nichts speichern", async () => {
    expect(await dienst.ladeKunde(fremd, deal.viktoria)).toBeNull();
    await expect(dienst.speichereKunde(fremd, deal.viktoria, { name: "X Y" }, null)).rejects.toThrow("Deal nicht gefunden");
  });

  it("Auszug, Name und E-Mail ergänzen: Lead und Person, Kalkulation angestoßen, Ereignis ohne Werte", async () => {
    const k = await dienst.speichereKunde(
      ws,
      deal.viktoria,
      { name: "Viktoria Muster", email: "v@beispiel.de", auszug: { strasse: "Hauptstr. 1", plz: "72218", ort: "Wildberg" }, quelle: "vorpruefung" },
      null
    );
    expect(k.name).toBe("Viktoria Muster");
    expect(k.email).toBe("v@beispiel.de");
    expect(k.telefon).toBe("0171 2345678");
    expect(k.auszug).toEqual({ strasse: "Hauptstr. 1", plz: "72218", ort: "Wildberg" });
    // Nichts geleert: Einzug und Datum bleiben.
    expect(k.einzug).toEqual({ strasse: "", plz: "71032", ort: "Böblingen" });
    expect(k.datum).toBe("2026-11-28");
    expect(angestossen).toHaveBeenCalledWith(ws, deal.viktoria);
    const [e] = await sql`select payload from activity_events where record_id = ${deal.viktoria} and event_type = 'deal.kunde_bearbeitet'`;
    expect(e.payload).toEqual({ felder: ["move_from_address", "name", "email"], quelle: "vorpruefung" });
    // Lead-Titel war der Alias: zieht mit.
    const [titel] = await sql`select text_value from record_values where record_id = ${deal.viktoria} and attribute_id = ${attr[`${obj.deals}.name`]}`;
    expect(titel.text_value).toBe("Viktoria Muster");
    const [ident] = await sql`select kind from person_identifiers where person_record_id = ${person}`;
    expect(ident.kind).toBe("email");
  });

  it("danach hat der VPS-Auftrag eine Kundenanschrift (Ursache behoben)", async () => {
    const [row] = await sql`select json_value from record_values where record_id = ${deal.viktoria} and attribute_id = ${attr[`${obj.deals}.move_from_address`]}`;
    const dealData = docData.buildDealDataForDocs(deal.viktoria, {
      name: "Viktoria Muster",
      person_name: "Viktoria Muster",
      person_vorname: "Viktoria",
      person_nachname: "Muster",
      move_date: "2026-11-28",
      move_from_address: row.json_value,
      move_to_address: null,
      floors_from: null,
      floors_to: null,
      elevator_from: null,
      elevator_to: null,
      inventory_notes: null,
      operating_company: { id: "oc", displayName: "Kottke" },
    });
    expect(dealData?.kunde.adresse).toBe("Hauptstr. 1, 72218, Wildberg");
  });

  it("Telefon ändern: neue Nummer vorn, alte bleibt", async () => {
    const k = await dienst.speichereKunde(ws, deal.viktoria, { telefon: "0157 1111111" }, null);
    expect(k.telefon).toBe("0157 1111111");
    const zeilen = await sql`select text_value from record_values where record_id = ${person} and attribute_id = ${attr[`${obj.people}.phone_numbers`]} order by sort_order`;
    expect(zeilen.map((z) => z.text_value).sort()).toEqual(["0157 1111111", "0171 2345678"]);
  });

  it("ohne Person: Speichern legt sie an und verknüpft sie, Name aus dem bereinigten Lead-Titel", async () => {
    const k = await dienst.speichereKunde(ws, deal.ohnePerson, { telefon: "0711 987654" }, null);
    expect(k.personId).not.toBeNull();
    expect(k.name).toBe("Familie Kraus");
    expect(k.nameAusPerson).toBe(true);
    expect(k.telefon).toBe("0711 987654");
  });
});

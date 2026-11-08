import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buchungsAnteil, rechnerBuchungFeld, type BuchungEingabe } from "@/lib/einsatz";

/**
 * Transporter-Buchungen gegen eine Wegwerf-Datenbank
 * (`EINSATZ_TEST_DATABASE_URL`, z. B. postgres://postgres@127.0.0.1:54351/p12_s).
 */
const url = process.env.EINSATZ_TEST_DATABASE_URL;

const halt = vi.hoisted(() => ({ ende: null as null | (() => Promise<void>) }));
vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.EINSATZ_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 4 });
  let zu = false;
  halt.ende = async () => {
    if (zu) return;
    zu = true;
    await client.end();
  };
  return { db: drizzle(client, { schema }) };
});

const auth = vi.hoisted(() => ({ workspaceId: "" }));
vi.mock("@/lib/api-utils", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-utils")>();
  return {
    ...actual,
    getAuthContext: async () => ({
      userId: "u1",
      workspaceId: auth.workspaceId,
      workspaceRole: "admin" as const,
      authMethod: "cookie" as const,
    }),
  };
});

import {
  buchungAendern,
  buchungAnlegen,
  buchungenMitWarnungen,
  dealBuchung,
  ladeBuchungen,
  loesen,
  zuordnen,
} from "./einsatz-buchungen";
import { einsatzSchalter } from "./plan5-schalter";
import { PATCH } from "@/app/api/v1/einsatz/buchungen/[id]/route";
import { GET as firmaLesen, PUT as firmaSetzen } from "@/app/api/v1/einsatz/firmen/[ocId]/route";

const ws = randomUUID();
const objDeals = randomUUID();
const objFirmen = randomUUID();
const attrName = randomUUID();
const attrFirma = randomUUID();
const attrMove = randomUUID();
const attrFirmenName = randomUUID();
const kottke = randomUUID();
const ceylan = randomUUID();
const mueller = randomUUID();
const schmidt = randomUUID();
const yilmaz = randomUUID();
const namenlos = randomUUID();

function eingabe(firmaId: string, extra: Partial<BuchungEingabe> = {}): BuchungEingabe {
  return {
    firmaId,
    von: "2026-11-17",
    bis: "2026-11-23",
    stationId: "st-1",
    stationName: "Sixt Feuerbach",
    stationAnbieter: "Sixt",
    klasseId: "kl-1",
    klasseName: "Sprinter L",
    mieteCent: 45000,
    inklusivKm: 800,
    mehrkmSatzCent: 35,
    geplanteAuftraege: 4,
    notiz: null,
    ...extra,
  };
}

describe.skipIf(!url)("Transporter-Buchungen (Datenbank)", () => {
  let sql: postgres.Sql;
  let drizzleZu = false;

  async function drizzleSchliessen() {
    if (drizzleZu) return;
    drizzleZu = true;
    await halt.ende?.();
  }

  async function buchungenWeg() {
    await sql`delete from deal_calculation_versions where workspace_id = ${ws}`;
    await sql`delete from deal_vehicle_bookings where workspace_id = ${ws}`;
    await sql`delete from vehicle_bookings where workspace_id = ${ws}`;
    await sql`delete from company_settings where workspace_id = ${ws}`;
  }

  beforeAll(async () => {
    sql = postgres(url!, { max: 2 });
    auth.workspaceId = ws;
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Einsatz', ${`t-${ws}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values
      (${objDeals}, ${ws}, 'deals', 'Deal', 'Deals'),
      (${objFirmen}, ${ws}, 'operating_companies', 'Firma', 'Firmen')`;
    await sql`insert into attributes (id, object_id, slug, title, type) values
      (${attrName}, ${objDeals}, 'name', 'Name', 'text'),
      (${attrFirma}, ${objDeals}, 'operating_company', 'Firma', 'record_reference'),
      (${attrMove}, ${objDeals}, 'move_date', 'Umzugstermin', 'date'),
      (${attrFirmenName}, ${objFirmen}, 'name', 'Name', 'text')`;
    await sql`insert into records (id, object_id) values
      (${kottke}, ${objFirmen}), (${ceylan}, ${objFirmen}),
      (${mueller}, ${objDeals}), (${schmidt}, ${objDeals}), (${yilmaz}, ${objDeals}), (${namenlos}, ${objDeals})`;
    await sql`insert into record_values (id, record_id, attribute_id, text_value) values
      (${randomUUID()}, ${kottke}, ${attrFirmenName}, 'Kottke'),
      (${randomUUID()}, ${ceylan}, ${attrFirmenName}, 'Ceylan'),
      (${randomUUID()}, ${mueller}, ${attrName}, 'Müller'),
      (${randomUUID()}, ${schmidt}, ${attrName}, 'Schmidt'),
      (${randomUUID()}, ${yilmaz}, ${attrName}, 'Yilmaz')`;
    await sql`insert into record_values (id, record_id, attribute_id, referenced_record_id) values
      (${randomUUID()}, ${mueller}, ${attrFirma}, ${kottke}),
      (${randomUUID()}, ${schmidt}, ${attrFirma}, ${kottke}),
      (${randomUUID()}, ${yilmaz}, ${attrFirma}, ${ceylan}),
      (${randomUUID()}, ${namenlos}, ${attrFirma}, ${kottke})`;
    await sql`insert into record_values (id, record_id, attribute_id, date_value) values
      (${randomUUID()}, ${mueller}, ${attrMove}, '2026-11-19'),
      (${randomUUID()}, ${schmidt}, ${attrMove}, '2026-11-20'),
      (${randomUUID()}, ${yilmaz}, ${attrMove}, '2026-11-19'),
      (${randomUUID()}, ${namenlos}, ${attrMove}, '2026-11-18')`;
  });

  beforeEach(async () => {
    await buchungenWeg();
    await sql`update records set deleted_at = null where object_id = ${objDeals}`;
    await sql`update record_values set date_value = '2026-11-19' where record_id = ${mueller} and attribute_id = ${attrMove}`;
    await sql`update record_values set date_value = '2026-11-20' where record_id = ${schmidt} and attribute_id = ${attrMove}`;
    await sql`update record_values set date_value = '2026-11-19' where record_id = ${yilmaz} and attribute_id = ${attrMove}`;
    await sql`update record_values set date_value = '2026-11-18' where record_id = ${namenlos} and attribute_id = ${attrMove}`;
  });

  afterAll(async () => {
    try {
      if (sql) {
        await buchungenWeg();
        await sql`delete from workspaces where id = ${ws}`;
      }
    } finally {
      await sql?.end();
      await drizzleSchliessen();
    }
  });

  it("legt an, lädt nach Fenster und Firma, ändert ohne die Firma zu verschieben", async () => {
    const spaeter = await buchungAnlegen(ws, eingabe(kottke, { von: "2026-11-20", bis: "2026-11-22", notiz: "  hinten  " }), "u1");
    expect(spaeter).toMatchObject({ status: "geplant", notiz: "hinten", firmaId: kottke, von: "2026-11-20", bis: "2026-11-22" });
    const lang = await buchungAnlegen(ws, eingabe(kottke, { von: "2026-11-24", bis: "2026-11-24", notiz: ` ${"a".repeat(400)} ` }), "u1");
    expect(lang.notiz).toHaveLength(300);
    const frueher = await buchungAnlegen(ws, eingabe(kottke, { von: "2026-11-10", bis: "2026-11-12" }), "u1");
    const andereFirma = await buchungAnlegen(ws, eingabe(ceylan, { von: "2026-11-11", bis: "2026-11-11" }), "u1");

    expect((await ladeBuchungen(ws, "2026-11-01", "2026-11-30")).map((b) => b.id)).toEqual([
      frueher.id,
      andereFirma.id,
      spaeter.id,
      lang.id,
    ]);
    expect((await ladeBuchungen(ws, "2026-11-01", "2026-11-30", kottke)).map((b) => b.id)).toEqual([frueher.id, spaeter.id, lang.id]);
    expect((await ladeBuchungen(ws, "2026-11-12", "2026-11-12")).map((b) => b.id)).toEqual([frueher.id]);
    expect(await ladeBuchungen(ws, "2026-12-01", "2026-12-07")).toEqual([]);

    const geaendert = await buchungAendern(ws, frueher.id, { mieteCent: 50000, firmaId: ceylan, notiz: "neu" }, "u2");
    expect(geaendert).toMatchObject({ buchung: { mieteCent: 50000, firmaId: kottke, notiz: "neu", bis: "2026-11-12" }, warnungen: [] });
    expect(await buchungAendern(ws, frueher.id, { bis: "2026-10-01" }, "u2")).toEqual({ fehler: "ZEITRAUM_UNGUELTIG" });
    expect((await ladeBuchungen(ws, "2026-11-01", "2026-11-30")).find((b) => b.id === frueher.id)?.bis).toBe("2026-11-12");

    await zuordnen(ws, spaeter.id, namenlos, "u1");
    const mit = await buchungenMitWarnungen(ws, "2026-11-20", "2026-11-22", kottke);
    expect(mit.map((b) => b.id)).toEqual([spaeter.id]);
    expect(mit[0].zuordnungen).toEqual([{ dealId: namenlos, titel: "Ohne Namen", tag: "2026-11-18", geschaetzteKm: null }]);
    expect(mit[0].text).toContain("Sprinter L");
    expect(mit[0].text).toContain("Sixt Feuerbach");

    await sql`update records set deleted_at = now() where id = ${namenlos}`;
    expect((await ladeBuchungen(ws, "2026-11-20", "2026-11-22"))[0].zuordnungen).toEqual([]);
  });

  it("storniert statt zu löschen; ein weiteres PATCH bleibt bei BUCHUNG_STORNIERT", async () => {
    const b = await buchungAnlegen(ws, eingabe(kottke), "u1");
    const erstes = await PATCH(patch(b.id, { status: "storniert" }), { params: Promise.resolve({ id: b.id }) });
    expect(erstes.status).toBe(200);
    expect((await sql`select status from vehicle_bookings where id = ${b.id}`)[0].status).toBe("storniert");
    expect(await sql`select count(*)::int as n from vehicle_bookings where id = ${b.id}`).toEqual([{ n: 1 }]);

    const nochmal = await PATCH(patch(b.id, { mieteCent: 1 }), { params: Promise.resolve({ id: b.id }) });
    expect(nochmal.status).toBe(409);
    expect((await nochmal.json()).error.code).toBe("BUCHUNG_STORNIERT");
    expect((await sql`select miete_cents from vehicle_bookings where id = ${b.id}`)[0].miete_cents).toBe(45000);
  });

  it("zuordnen: falsche Firma, Verschieben, Kilometer der neuesten Empfehlung", async () => {
    const fremd = await buchungAnlegen(ws, eingabe(ceylan), "u1");
    expect(await zuordnen(ws, fremd.id, mueller, "u1")).toEqual({ ok: false, code: "FALSCHE_FIRMA" });
    expect((await sql`select count(*)::int as n from deal_vehicle_bookings where deal_record_id = ${mueller}`)[0].n).toBe(0);

    await sql`insert into deal_calculation_versions (id, workspace_id, deal_record_id, version, status, reference_date, rechner_result) values
      (${randomUUID()}, ${ws}, ${mueller}, 1, 'gesperrt', '2026-11-01', ${sql.json({ empfehlungOptionId: "alt", fahrzeugoptionen: [{ id: "alt", km: 99 }] })}),
      (${randomUUID()}, ${ws}, ${mueller}, 2, 'gesperrt', '2026-11-01', ${sql.json({ empfehlungOptionId: "b", fahrzeugoptionen: [{ id: "a", km: 10 }, { id: "b", km: 42.4 }] })}),
      (${randomUUID()}, ${ws}, ${mueller}, 3, 'gesperrt', '2026-11-01', null),
      (${randomUUID()}, ${ws}, ${schmidt}, 9, 'gesperrt', '2026-11-01', ${sql.json({ empfehlungOptionId: "x", fahrzeugoptionen: [{ id: "x", km: 1 }] })})`;

    const erste = await buchungAnlegen(ws, eingabe(kottke), "u1");
    const zweite = await buchungAnlegen(ws, eingabe(kottke, { von: "2026-11-18", bis: "2026-11-21" }), "u1");
    expect((await zuordnen(ws, erste.id, mueller, "u1"))?.ok).toBe(true);
    expect((await zuordnen(ws, zweite.id, mueller, "u2"))?.ok).toBe(true);
    const zeilen = await sql`select booking_id, geschaetzte_km from deal_vehicle_bookings where deal_record_id = ${mueller}`;
    expect(zeilen).toEqual([{ booking_id: zweite.id, geschaetzte_km: 42 }]);
    expect((await dealBuchung(ws, mueller))?.id).toBe(zweite.id);
    expect(await loesen(ws, mueller)).toBe(true);
    expect(await dealBuchung(ws, mueller)).toBeNull();
    expect(await loesen(ws, mueller)).toBe(false);
  });

  it("warnt bei mehr Aufträgen als geplant und bei einem Termin außerhalb", async () => {
    const eng = await buchungAnlegen(ws, eingabe(kottke, { geplanteAuftraege: 1, inklusivKm: null }), "u1");
    expect(await zuordnen(ws, eng.id, mueller, "u1")).toMatchObject({ ok: true, warnungen: [] });
    expect(await zuordnen(ws, eng.id, schmidt, "u1")).toEqual({
      ok: true,
      warnungen: ["2 Aufträge zugeordnet, geplant waren 1."],
    });

    await sql`update record_values set date_value = '2026-12-01' where record_id = ${schmidt} and attribute_id = ${attrMove}`;
    const weit = await buchungAnlegen(ws, eingabe(kottke, { geplanteAuftraege: 2 }), "u1");
    expect(await zuordnen(ws, weit.id, schmidt, "u1")).toEqual({
      ok: true,
      warnungen: ["Termin außerhalb der Buchung: Schmidt."],
    });
  });

  it("warnt, wenn gesperrte Preise auf dem alten Stand der Buchung beruhen, und nach Storno", async () => {
    const b = await buchungAnlegen(ws, eingabe(kottke), "u1");
    const feld = rechnerBuchungFeld(b, buchungsAnteil(b));
    await sql`insert into deal_calculation_versions (id, workspace_id, deal_record_id, version, status, reference_date, rechner_request, vehicle_booking_id) values
      (${randomUUID()}, ${ws}, ${mueller}, 1, 'gesperrt', '2026-11-19', ${sql.json({ umzugsdatum: "2026-11-19", buchung: feld })}, ${b.id})`;
    await sql`insert into deal_calculation_versions (id, workspace_id, deal_record_id, version, status, reference_date, rechner_request, vehicle_booking_id) values
      (${randomUUID()}, ${ws}, ${mueller}, 2, 'entwurf', '2026-11-19', ${sql.json({})}, ${b.id})`;

    const geaendert = await buchungAendern(ws, b.id, { mieteCent: 90000 }, "u1");
    expect(geaendert).toEqual({
      buchung: expect.objectContaining({ mieteCent: 90000 }),
      warnungen: ["1 gesendete Preise beruhen auf dem alten Stand der Buchung (Müller). Die Preise bleiben."],
    });

    const storno = await buchungAendern(ws, b.id, { status: "storniert" }, "u1");
    expect(storno).toEqual({
      buchung: expect.objectContaining({ status: "storniert" }),
      warnungen: ["Storniert, aber 1 gesendete Preise rechnen mit dieser Buchung (Müller). Die Preise bleiben."],
    });
  });

  it("erkennt die Buchung auch über day_prices.vehicleBookingId", async () => {
    const b = await buchungAnlegen(ws, eingabe(kottke), "u1");
    const feld = rechnerBuchungFeld(b, buchungsAnteil(b));
    await sql`insert into deal_calculation_versions (id, workspace_id, deal_record_id, version, status, reference_date, rechner_request, day_prices) values
      (${randomUUID()}, ${ws}, ${schmidt}, 1, 'gesperrt', '2026-11-20', ${sql.json({ umzugsdatum: "2026-11-20", buchung: feld })}, ${sql.json([{ vehicleBookingId: b.id, datum: "2026-11-20", festpreis: 100 }])})`;
    const geaendert = await buchungAendern(ws, b.id, { mieteCent: 90000 }, "u1");
    expect(geaendert && "warnungen" in geaendert && geaendert.warnungen).toEqual([
      "1 gesendete Preise beruhen auf dem alten Stand der Buchung (Schmidt). Die Preise bleiben.",
    ]);
  });

  it("einsatzSchalter ist aus ohne Zeile und an nach dem PUT", async () => {
    expect(await einsatzSchalter(ws, mueller)).toEqual({ buchungImPreis: false });
    const vorher = await firmaLesen(new NextRequest(`http://localhost/api/v1/einsatz/firmen/${kottke}`), {
      params: Promise.resolve({ ocId: kottke }),
    });
    expect(vorher.status).toBe(200);
    expect(await vorher.json()).toEqual({ data: { buchungImPreis: false } });

    const gesetzt = await firmaSetzen(putFirma(kottke, true), { params: Promise.resolve({ ocId: kottke }) });
    expect(gesetzt.status).toBe(200);
    expect(await gesetzt.json()).toEqual({ data: { buchungImPreis: true } });
    expect(await einsatzSchalter(ws, mueller)).toEqual({ buchungImPreis: true });
    expect(await einsatzSchalter(ws, yilmaz)).toEqual({ buchungImPreis: false });

    await sql`update company_settings set zeitposten = ${sql.json([{ name: "Tragen" }])}, rechner_marke = 'kottke' where operating_company_record_id = ${kottke}`;
    const zurueck = await firmaSetzen(putFirma(kottke, false), { params: Promise.resolve({ ocId: kottke }) });
    expect(zurueck.status).toBe(200);
    const [zeile] = await sql`select zeitposten, rechner_marke, buchung_im_preis from company_settings where operating_company_record_id = ${kottke}`;
    expect(zeile.buchung_im_preis).toBe(false);
    expect(zeile.rechner_marke).toBe("kottke");
    expect(zeile.zeitposten).toEqual([{ name: "Tragen" }]);
    expect(await einsatzSchalter(ws, mueller)).toEqual({ buchungImPreis: false });
  });
});

function patch(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/v1/einsatz/buchungen/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function putFirma(ocId: string, buchungImPreis: boolean) {
  return new NextRequest(`http://localhost/api/v1/einsatz/firmen/${ocId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ buchungImPreis }),
  });
}

afterAll(async () => {
  await halt.ende?.();
});

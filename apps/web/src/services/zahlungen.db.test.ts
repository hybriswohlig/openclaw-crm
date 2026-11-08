import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Plan 9, Task B gegen eine echte Postgres-DB: Storno als Gegenbuchung,
 * Korrektur, Löschsperre, Bearbeiten mit Ereignis, Bar erhalten, Alarm genau
 * einmal je Meldung, bezahlt_am. Nur mit GELD_TEST_DATABASE_URL (Wegwerf-DB).
 */
const url = process.env.GELD_TEST_DATABASE_URL;
const m = vi.hoisted(() => ({ gesendet: [] as string[] }));

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.GELD_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 6 });
  return { db: drizzle(client, { schema }), __client: client };
});
vi.mock("./wartet", () => ({ aktualisiereWartet: async () => {}, aktualisiereWartetNachBesuch: async () => {}, setzeStufeBetreten: async () => {} }));
vi.mock("./customer-portal-notifications", () => ({ maybeNotifyDepositReceived: async () => {}, maybeNotifyPortalEvent: async () => {} }));
vi.mock("./intern/intern-senden", () => ({
  sendeAnInterne: async (_ws: string, text: string) => {
    m.gesendet.push(text);
    return { zugestellt: ["a", "b"], fehlgeschlagen: [] };
  },
}));
vi.mock("./durchgefuehrt", () => ({ markiereDurchgefuehrt: async () => {} }));

describe.skipIf(!url)("Zahlungen: Storno, Korrektur, Bar, Alarm, bezahlt_am (DB, Plan 9 Task B)", { timeout: 30_000 }, () => {
  let sql: postgres.Sql;
  let fin: typeof import("./financial");
  let meld: typeof import("./zahlungsmeldungen");
  let nach: typeof import("./nach-zahlung");
  let offen: typeof import("./offener-rest");
  const ws = randomUUID();
  const objDeals = randomUUID();
  const objFirmen = randomUUID();
  const attrFirma = randomUUID();
  const attrName = randomUUID();
  const attrStage = randomUUID();
  const firma = randomUUID();
  const stDone = randomUUID();
  const stPaid = randomUUID();
  const mitarbeiter = randomUUID();
  let deal = "";

  async function neuerDeal(annahmeCent = 100000) {
    const id = randomUUID();
    await sql`insert into records (id, object_id) values (${id}, ${objDeals})`;
    await sql`insert into record_values (id, record_id, attribute_id, referenced_record_id) values (${randomUUID()}, ${id}, ${attrFirma}, ${firma})`;
    await sql`insert into record_values (id, record_id, attribute_id, text_value) values (${randomUUID()}, ${id}, ${attrName}, 'Familie Muster'), (${randomUUID()}, ${id}, ${attrStage}, ${stDone})`;
    await sql`insert into quotations (id, deal_record_id, is_variable, fixed_price) values (${randomUUID()}, ${id}, false, ${(annahmeCent / 100).toFixed(2)})`;
    return id;
  }

  async function gestellteRechnung(d: string, cent: number) {
    await sql`insert into deal_invoices (id, workspace_id, deal_record_id, operating_company_id, herkunft, status, brutto_cent, rechnungstag, faellig_am)
      values (${randomUUID()}, ${ws}, ${d}, ${firma}, 'upload', 'gestellt', ${cent}, '2026-11-07', '2026-11-07')`;
  }

  const zahlung = (d: string, amount: string, extra: Partial<Parameters<typeof fin.createPayment>[2]> = {}) =>
    fin.createPayment(ws, d, { date: "2026-11-07", amount, paymentMethod: "bank_transfer", quelle: "hand", createdBy: "u1", ...extra });

  beforeAll(async () => {
    sql = postgres(url!, { max: 2 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'Test', ${`t-${ws}`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${objDeals}, ${ws}, 'deals', 'Deal', 'Deals'), (${objFirmen}, ${ws}, 'operating_companies', 'Firma', 'Firmen')`;
    await sql`insert into attributes (id, object_id, slug, title, type) values
      (${attrFirma}, ${objDeals}, 'operating_company', 'Firma', 'record_reference'),
      (${attrName}, ${objDeals}, 'name', 'Name', 'text'),
      (${attrStage}, ${objDeals}, 'stage', 'Stufe', 'status'),
      (${randomUUID()}, ${objFirmen}, 'name', 'Name', 'text')`;
    await sql`insert into statuses (id, attribute_id, title, stage_category, sort_order) values
      (${stDone}, ${attrStage}, 'Durchgeführt', 'done_unpaid', 5), (${stPaid}, ${attrStage}, 'Bezahlt', 'paid', 6)`;
    await sql`insert into records (id, object_id) values (${firma}, ${objFirmen})`;
    await sql`insert into record_values (id, record_id, attribute_id, text_value)
      select ${randomUUID()}, ${firma}, id, 'Kottke' from attributes where object_id = ${objFirmen} and slug = 'name'`;
    await sql`insert into employees (id, workspace_id, name, hourly_rate) values (${mitarbeiter}, ${ws}, 'Hans', '20.00')`;
    fin = await import("./financial");
    meld = await import("./zahlungsmeldungen");
    nach = await import("./nach-zahlung");
    offen = await import("./offener-rest");
  });

  beforeEach(async () => {
    m.gesendet = [];
    deal = await neuerDeal();
  });

  afterAll(async () => {
    await sql?.end();
    await ((await import("@/db")) as unknown as { __client: postgres.Sql }).__client.end();
  });

  it("Storno ist eine Gegenbuchung mit eigener Belegnummer; jede Summe ergibt null; zweites Storno 409", async () => {
    const z = await zahlung(deal, "400.00");
    expect(z.receiptNumber).toMatch(/^K-E-2026-\d{4}$/);
    expect((await offen.offenerRest(ws, deal)).restCent).toBe(60000);
    const s = await fin.stornierePayment(ws, deal, z.id, "Doppelt erfasst", "u1");
    expect(s).toMatchObject({ amount: "-400.00", quelle: "storno", stornoVonPaymentId: z.id, operatingCompanyId: firma, taxTreatment: "betriebseinnahme" });
    expect(s.receiptNumber).not.toBe(z.receiptNumber);
    expect((await offen.offenerRest(ws, deal)).restCent).toBe(100000);
    await expect(fin.stornierePayment(ws, deal, z.id, "Noch einmal", "u1")).rejects.toMatchObject({ code: "SCHON_STORNIERT" });
    await expect(fin.stornierePayment(ws, deal, s.id, "Storno vom Storno", "u1")).rejects.toMatchObject({ code: "SCHON_STORNIERT" });
    await expect(fin.stornierePayment(ws, deal, z.id, "kurz", "u1")).rejects.toMatchObject({ code: "SCHON_STORNIERT" });
    const [{ summe }] = await sql`select coalesce(sum(amount), 0)::text as summe from payments where deal_record_id = ${deal}`;
    expect(Number(summe)).toBe(0);
  });

  it("zwei gleichzeitige Stornos: genau eine Gegenbuchung", async () => {
    const z = await zahlung(deal, "100.00");
    const r = await Promise.allSettled([
      fin.stornierePayment(ws, deal, z.id, "Falsch gebucht", "u1"),
      fin.stornierePayment(ws, deal, z.id, "Falsch gebucht", "u2"),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const [{ n }] = await sql`select count(*)::int as n from payments where storno_von_payment_id = ${z.id}`;
    expect(n).toBe(1);
  });

  it("Korrektur: Storno plus neue Zahlung in einer Transaktion; Fehler rollt beides zurück", async () => {
    const z = await zahlung(deal, "300.00");
    const k = await fin.zahlungKorrigieren(ws, deal, z.id, { date: "2026-11-08", amountCent: 35000, paymentMethod: "cash", kaution: false, grund: "Betrag vertippt" }, "u1");
    expect(k.storno.amount).toBe("-300.00");
    expect(k.neu).toMatchObject({ amount: "350.00", quelle: "hand", paymentMethod: "cash" });
    expect((await offen.offenerRest(ws, deal)).restCent).toBe(65000);
    const vorher = await sql`select count(*)::int as n from payments where deal_record_id = ${deal}`;
    await expect(
      fin.zahlungKorrigieren(ws, deal, z.id, { date: "2026-11-08", amountCent: 1, paymentMethod: "cash", kaution: false, grund: "Noch einmal" }, "u1")
    ).rejects.toMatchObject({ code: "SCHON_STORNIERT" });
    const nachher = await sql`select count(*)::int as n from payments where deal_record_id = ${deal}`;
    expect(nachher[0].n).toBe(vorher[0].n);
  });

  it("Löschen: mit Belegnummer 409, ohne (Kaution) wie bisher; Bearbeiten nur Datum/Art/Notiz mit Ereignis", async () => {
    const z = await zahlung(deal, "50.00");
    await expect(fin.deletePayment(z.id, ws, deal)).rejects.toMatchObject({ code: "NUR_STORNO" });
    const kaution = await zahlung(deal, "20.00", { taxTreatment: "nicht_steuerbar" });
    expect(kaution.receiptNumber).toBeNull();
    expect(await fin.deletePayment(kaution.id, ws, deal)).toMatchObject({ id: kaution.id });

    await expect(fin.updatePayment(z.id, ws, { amount: "60.00" }, { dealRecordId: deal })).rejects.toMatchObject({ code: "NUR_KORREKTUR" });
    await expect(fin.updatePayment(z.id, ws, { taxTreatment: "nicht_steuerbar" }, { dealRecordId: deal })).rejects.toMatchObject({ code: "NUR_KORREKTUR" });
    expect(await fin.updatePayment(z.id, ws, { notes: "x" }, { dealRecordId: await neuerDeal() })).toBeNull();
    const geaendert = await fin.updatePayment(z.id, ws, { amount: "50", notes: "Überweisung vom 06.11." }, { dealRecordId: deal, userId: "u1" });
    expect(geaendert).toMatchObject({ amount: "50.00", notes: "Überweisung vom 06.11." });
    const [ev] = await sql`select payload, actor_id from activity_events where record_id = ${deal} and event_type = 'payment.geaendert'`;
    expect(ev.actor_id).toBe("u1");
    expect(ev.payload).toMatchObject({ paymentId: z.id, vorher: { notes: null }, nachher: { notes: "Überweisung vom 06.11." } });
  });

  it("Bar erhalten nur für Kassieren des Teams und nur einmal", async () => {
    const bar = await zahlung(deal, "450.00", { quelle: "mitarbeiter", employeeId: mitarbeiter, paymentMethod: "cash" });
    const hand = await zahlung(deal, "10.00");
    expect(await fin.barErhalten(ws, deal, [bar.id, hand.id], "u1")).toBe(1);
    expect(await fin.barErhalten(ws, deal, [bar.id], "u1")).toBe(0);
    const [z] = await sql`select bar_erhalten_von, bar_erhalten_am from payments where id = ${bar.id}`;
    expect(z.bar_erhalten_von).toBe("u1");
    expect(z.bar_erhalten_am).not.toBeNull();
  });

  it("bezahlt_am: gesetzt bei Rest 0 mit gestellter Rechnung (Stufe Bezahlt), geleert nach Storno, Stufe bleibt", async () => {
    await gestellteRechnung(deal, 100000);
    const z = await zahlung(deal, "1000.00");
    expect(await nach.nachZahlung(ws, deal, null)).toEqual({ stufeGesetzt: true, bezahltAm: "gesetzt" });
    const [s1] = await sql`select bezahlt_am from deal_workflow_state where record_id = ${deal}`;
    expect(s1.bezahlt_am).not.toBeNull();
    // Zweiter Lauf ändert nichts.
    expect((await nach.nachZahlung(ws, deal, null)).bezahltAm).toBeNull();

    await fin.stornierePayment(ws, deal, z.id, "Rücklastschrift", "u1");
    const [s2] = await sql`select bezahlt_am from deal_workflow_state where record_id = ${deal}`;
    expect(s2.bezahlt_am).toBeNull();
    const [stufe] = await sql`select text_value from record_values where record_id = ${deal} and attribute_id = ${attrStage}`;
    expect(stufe.text_value).toBe(stPaid);
  });

  it("Bargeld ohne Rechnung setzt noch nichts", async () => {
    await zahlung(deal, "1000.00", { quelle: "mitarbeiter", employeeId: mitarbeiter, paymentMethod: "cash" });
    expect(await nach.nachZahlung(ws, deal, null)).toEqual({ stufeGesetzt: false, bezahltAm: null });
  });

  it("Alarm genau einmal je Meldung, auch bei parallelen Aufrufen; nach Bestätigen gilt die nächste neu", async () => {
    let minute = 0;
    const melde = async () => {
      const id = randomUUID();
      minute += 1;
      await sql`insert into activity_events (id, workspace_id, record_id, object_slug, event_type, payload, created_at)
        values (${id}, ${ws}, ${deal}, 'deals', 'customer.marked_paid', ${sql.json({ method: "bank_transfer", amountCents: 50000, variant: "final" })}, now() - interval '1 hour' + ${minute} * interval '1 minute')`;
      return id;
    };
    const e1 = await melde();
    const e2 = await melde();
    const r = await Promise.all([meld.meldungsAlarm(ws, deal, e1), meld.meldungsAlarm(ws, deal, e2), meld.meldungsAlarm(ws, deal, e2)]);
    expect(r.filter(Boolean)).toHaveLength(1);
    expect(m.gesendet).toHaveLength(1);
    expect(m.gesendet[0].replace(/\s/g, " ")).toBe("Kunde meldet bezahlt: Familie Muster, Restzahlung 500,00 €. Bitte nach dem Zahlungseingang in der Kasse bestätigen.");
    const [{ n }] = await sql`select count(*)::int as n from activity_events where record_id = ${deal} and event_type = 'payment.meldung_alarm'`;
    expect(n).toBe(1);

    await meld.verwerfeZahlungsmeldung(ws, deal, e2, "u1");
    const e3 = await melde();
    expect(await meld.meldungsAlarm(ws, deal, e3)).toBe(true);
    expect(m.gesendet).toHaveLength(2);
  });

  it("Bestätigen schreibt Quelle meldung", async () => {
    const id = randomUUID();
    await sql`insert into activity_events (id, workspace_id, record_id, object_slug, event_type, payload)
      values (${id}, ${ws}, ${deal}, 'deals', 'customer.marked_paid', ${sql.json({ method: "bank_transfer", amountCents: 20000, variant: "final" })})`;
    const { paymentId } = await meld.bestaetigeZahlungsmeldung(ws, deal, id, "u1");
    const [z] = await sql`select quelle, created_by, amount from payments where id = ${paymentId}`;
    expect(z).toMatchObject({ quelle: "meldung", created_by: "u1", amount: "200.00" });
  });
});

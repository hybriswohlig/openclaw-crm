import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CrewBriefing } from "@/lib/crew/contract";
import type { CrewKontext } from "./auth";
import { crewTestSchemaAnlegen, wertSetzen } from "./testdb";

/**
 * Briefing: Freigabe, Lesen, Gelesen, Erneut freigeben, Zurückziehen und der
 * WhatsApp-Versand (Attrappe, nie echtes WhatsApp) gegen die Wegwerf-Postgres.
 */
const url = process.env.EINSATZ_TEST_DATABASE_URL;
const h = vi.hoisted(() => ({ schema: `crew_briefing_${Date.now().toString(36)}` }));

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.EINSATZ_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", {
    max: 4,
    onnotice: () => {},
    connection: { search_path: h.schema },
  });
  return { db: drizzle(client, { schema }) };
});
vi.mock("@/services/inbox-whatsapp", () => ({
  sendBaileysDirektText: () => {
    throw new Error("echter Versand im Test");
  },
}));

const kontext = (id: string, name: string): CrewKontext => ({
  workspaceId: "w1",
  linkId: `l_${id}`,
  employee: { id, name, locale: "de", canDriveSprinter: false, rateWorkCents: 2000, rateDriveCents: 1500 },
});
const leiter = kontext("e1", "Ali Kaya");
const helfer = kontext("e2", "Ben Bauer");
const fremd = kontext("e3", "Cem Can");
const TAG = "2099-01-15";

describe.skipIf(!url)("Briefing (DB)", { timeout: 30_000 }, () => {
  let sql: postgres.Sql;
  let br: typeof import("./briefing");
  let fg: typeof import("./briefing-freigabe");
  let jobs: typeof import("./jobs");
  const senden = vi.fn();
  const absender = vi.fn();
  const deps = () => ({ senden, absender });
  const A: Record<string, string> = {};

  beforeAll(async () => {
    sql = postgres(url!, { max: 1, onnotice: () => {} });
    await crewTestSchemaAnlegen(sql, h.schema);
    await sql.unsafe(`
      INSERT INTO workspaces VALUES ('w1');
      INSERT INTO objects VALUES ('od', 'w1', 'deals'), ('oa', 'w1', 'auftraege'), ('oc', 'w1', 'operating_companies'), ('ot', 'w1', 'transport_depots');
      INSERT INTO employees (id, workspace_id, name) VALUES ('e1', 'w1', 'Ali Kaya'), ('e2', 'w1', 'Ben Bauer'), ('e3', 'w1', 'Cem Can'), ('e4', 'w1', 'Dana Dorn');
      UPDATE employees SET phone_canonical = '+491511111111', locale = 'tr' WHERE id = 'e1';
      UPDATE employees SET phone_canonical = '+491522222222' WHERE id = 'e2';
    `);
    const slugs: Array<[string, string[]]> = [
      ["od", ["stage", "move_date", "move_from_address", "move_to_address", "floors_from", "floors_to", "elevator_from", "elevator_to", "name"]],
      [
        "oa",
        [
          "deal", "operating_company", "worker_count", "load_unload_minutes", "transporter", "depot", "boxes_needed", "equipment_needed",
          "contact_pickup_name", "contact_pickup_phone", "payment_method", "amount_outstanding", "special_requests", "notes", "checklist",
          "time_window_start",
        ],
      ],
      ["oc", ["name"]],
      ["ot", ["name", "address"]],
    ];
    for (const [obj, liste] of slugs) {
      for (const s of liste) {
        const id = `${obj}_${s}`;
        await sql`INSERT INTO attributes VALUES (${id}, ${obj}, ${s})`;
        A[`${obj}.${s}`] = id;
      }
    }
    await sql`INSERT INTO statuses VALUES ('st_booked', ${A["od.stage"]!}, 'booked')`;
    await sql`INSERT INTO select_options VALUES ('so_bar', ${A["oa.payment_method"]!}, 'Bar'), ('so_sprinter', ${A["oa.transporter"]!}, 'Mercedes Sprinter lang'),
      ('so_decken', ${A["oa.equipment_needed"]!}, 'Decken'), ('so_sack', ${A["oa.equipment_needed"]!}, 'Sackkarre'), ('so_treppe', ${A["od.elevator_from"]!}, 'Treppe')`;
    await sql`INSERT INTO records (id, object_id) VALUES ('k1', 'oc'), ('dep1', 'ot'), ('d1', 'od'), ('au1', 'oa'), ('d2', 'od'), ('au2', 'oa')`;
    await wertSetzen(sql, "k1", A["oc.name"]!, { text: "Kottke-Umzüge" });
    await wertSetzen(sql, "dep1", A["ot.name"]!, { text: "Depot Nord" });
    await wertSetzen(sql, "dep1", A["ot.address"]!, { json: { line1: "Industriestr. 1", postcode: "70469", city: "Stuttgart" } });
    for (const d of ["d1", "d2"]) {
      await wertSetzen(sql, d, A["od.stage"]!, { text: "st_booked" });
      await wertSetzen(sql, d, A["od.move_date"]!, { datum: TAG });
      await wertSetzen(sql, d, A["od.name"]!, { text: "Familie Geheim" });
      const au = d === "d1" ? "au1" : "au2";
      await wertSetzen(sql, au, A["oa.deal"]!, { ref: d });
      await wertSetzen(sql, au, A["oa.operating_company"]!, { ref: "k1" });
      await wertSetzen(sql, au, A["oa.worker_count"]!, { zahl: 2 });
      await wertSetzen(sql, au, A["oa.load_unload_minutes"]!, { zahl: 300 });
    }
    await wertSetzen(sql, "d1", A["od.move_from_address"]!, { json: { line1: "Hauptstraße 5", postcode: "70176", city: "Stuttgart" } });
    await wertSetzen(sql, "d1", A["od.move_to_address"]!, { json: { line1: "Rosenweg 3", postcode: "72070", city: "Tübingen" } });
    await wertSetzen(sql, "d1", A["od.floors_from"]!, { zahl: 2 });
    await wertSetzen(sql, "d1", A["od.elevator_from"]!, { text: "so_treppe" });
    await wertSetzen(sql, "au1", A["oa.transporter"]!, { text: "so_sprinter" });
    await wertSetzen(sql, "au1", A["oa.depot"]!, { ref: "dep1" });
    await wertSetzen(sql, "au1", A["oa.boxes_needed"]!, { zahl: 20 });
    await sql`INSERT INTO record_values (record_id, attribute_id, text_value, sort_order) VALUES ('au1', ${A["oa.equipment_needed"]!}, 'so_sack', 1), ('au1', ${A["oa.equipment_needed"]!}, 'so_decken', 0)`;
    await wertSetzen(sql, "au1", A["oa.contact_pickup_name"]!, { text: "Matthias" });
    await wertSetzen(sql, "au1", A["oa.contact_pickup_phone"]!, { text: "0151 16054638" });
    await wertSetzen(sql, "au1", A["oa.payment_method"]!, { text: "so_bar" });
    await wertSetzen(sql, "au1", A["oa.amount_outstanding"]!, { json: { amount: 1240, currencyCode: "EUR" } });
    await wertSetzen(sql, "au1", A["oa.special_requests"]!, { text: "Klavier vorsichtig" });
    await wertSetzen(sql, "au1", A["oa.notes"]!, { text: "INTERN Rabatt 200" });
    await wertSetzen(sql, "au1", A["oa.checklist"]!, { json: [{ key: "lkw_getankt", label: "LKW getankt", done: false }] });
    await sql`INSERT INTO deal_employees (deal_record_id, employee_id, role, created_at) VALUES ('d1', 'e1', 'lead', now() - interval '1 minute'), ('d1', 'e2', 'helper', now()), ('d1', 'e4', 'helper', now() + interval '1 minute')`;

    br = await import("./briefing");
    fg = await import("./briefing-freigabe");
    jobs = await import("./jobs");
  }, 60_000);

  afterAll(async () => {
    await sql?.unsafe(`DROP SCHEMA ${h.schema} CASCADE`);
    await sql?.end();
  });

  beforeEach(() => {
    senden.mockReset().mockResolvedValue({ externalMessageId: "m1" });
    absender.mockReset().mockResolvedValue("konto-r");
  });

  const status = async (k: CrewKontext, deal: string) => (await jobs.ladeCrewJobs(k, { dealIds: [deal] }))[0]?.briefing;

  it("vor der Freigabe: kein Briefing, nur das Team sieht überhaupt den Stand", async () => {
    expect(await status(leiter, "d1")).toBeNull();
    expect(await br.briefingLesen(leiter, "d1")).toEqual({ ok: false, code: "BRIEFING_NICHT_FREI" });
    expect(await br.briefingLesen(fremd, "d1")).toEqual({ ok: false, code: "JOB_NICHT_SICHTBAR" });
    expect(await br.briefingGelesen(leiter, "d1")).toEqual({ ok: false, code: "BRIEFING_NICHT_FREI" });
    const s = await fg.briefingStandLesen("w1", "d1");
    expect(s.freigegebenAm).toBeNull();
    expect(s.team.map((p) => [p.employeeId, p.rolle, p.hatTelefon, p.versand])).toEqual([
      ["e1", "lead", true, null],
      ["e2", "helper", true, null],
      ["e4", "helper", false, null],
    ]);
  });

  it("ohne Team lässt sich nichts freigeben", async () => {
    expect(await fg.briefingFreigeben("w1", "d2", { whatsapp: true }, "u1", deps())).toEqual({ ok: false, code: "KEIN_TEAM" });
    expect(senden).not.toHaveBeenCalled();
  });

  it("Freigabe mit WhatsApp: je Person einmal, in ihrer Sprache, mit Briefing-Link; ohne Nummer festgehalten", async () => {
    const r = await fg.briefingFreigeben("w1", "d1", { whatsapp: true }, "u1", deps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(senden).toHaveBeenCalledTimes(2);
    const [an1, an2] = senden.mock.calls.map((c) => c[0]);
    expect(an1.accountId).toBe("konto-r");
    expect(an1.peerWaId).toBe("491511111111");
    expect(an1.text).toContain("Merhaba Ali");
    expect(an1.text).toMatch(/\/l\/[A-Za-z0-9_-]{32}\?b=d1/);
    expect(an2.text).toContain("Hallo Ben!");
    expect(r.stand.freigegebenAm).not.toBeNull();
    expect(r.stand.team.map((p) => p.versand?.status)).toEqual(["gesendet", "gesendet", "kein_telefon"]);
    expect(await status(leiter, "d1")).toBe("neu");
    expect(await status(helfer, "d1")).toBe("neu");
  });

  it("Inhalt: Stopps, Team, Fahrzeug mit Depot, Material, Wünsche; Barzahlung nur für die Teamleitung; nie Notizen oder Checkliste", async () => {
    const l = await br.briefingLesen(leiter, "d1");
    expect(l.ok).toBe(true);
    if (!l.ok) return;
    expect(CrewBriefing.parse(l.briefing)).toBeTruthy();
    const b = l.briefing;
    expect(b.stops.map((s) => [s.kind, s.address, s.floor, s.access])).toEqual([
      ["from", "Hauptstraße 5, 70176 Stuttgart", 2, "Treppe"],
      ["to", "Rosenweg 3, 72070 Tübingen", null, null],
    ]);
    expect(b.stops[0]!.contact).toEqual({ name: "Matthias", phone: "0151 16054638" });
    expect(b.team.map((m) => [m.firstName, m.role, m.me])).toEqual([
      ["Ali", "lead", true],
      ["Ben", "helper", false],
      ["Dana", "helper", false],
    ]);
    expect(b.vehicle).toBe("Mercedes Sprinter lang");
    expect(b.vehiclePickup).toEqual({ name: "Depot Nord", address: "Industriestr. 1, 70469 Stuttgart" });
    expect(b.equipment).toEqual(["Decken", "Sackkarre"]);
    expect(b.boxes).toBe(20);
    expect(b.wishes).toBe("Klavier vorsichtig");
    expect(b.payment).toEqual({ kind: "bar", amountCents: 124000 });
    expect(b.job.id).toBe("d1");
    expect(b.job.briefing).toBe("neu");
    const text = JSON.stringify(b);
    expect(text).not.toContain("INTERN");
    expect(text).not.toContain("LKW getankt");

    const hl = await br.briefingLesen(helfer, "d1");
    expect(hl.ok && hl.briefing.payment).toBeNull();
    expect(hl.ok && hl.briefing.team.find((m) => m.me)?.firstName).toBe("Ben");
  });

  it("Gelesen gilt bis zur nächsten Freigabe; mehrfach tippen ändert nichts", async () => {
    const g1 = await br.briefingGelesen(helfer, "d1");
    const g2 = await br.briefingGelesen(helfer, "d1");
    expect(g1.ok && g2.ok && g1.readAt === g2.readAt).toBe(true);
    expect(await status(helfer, "d1")).toBe("gelesen");
    expect(await status(leiter, "d1")).toBe("neu");
    const s = await fg.briefingStandLesen("w1", "d1");
    expect(s.team.map((p) => !!p.gelesenAm)).toEqual([false, true, false]);

    // Erneut freigeben ohne WhatsApp: wieder neu für alle, kein Versand, alter Versand gilt nicht mehr.
    await new Promise((r) => setTimeout(r, 5));
    const r = await fg.briefingFreigeben("w1", "d1", { whatsapp: false }, "u1", deps());
    expect(senden).not.toHaveBeenCalled();
    expect(r.ok && r.stand.team.map((p) => [!!p.gelesenAm, p.versand])).toEqual([
      [false, null],
      [false, null],
      [false, null],
    ]);
    expect(await status(helfer, "d1")).toBe("neu");
  });

  it("Zurückziehen: niemand sieht es mehr; ohne verbundenes WhatsApp wird nichts gesendet, aber festgehalten", async () => {
    const s = await fg.briefingZurueckziehen("w1", "d1");
    expect(s.freigegebenAm).toBeNull();
    expect(await status(leiter, "d1")).toBeNull();
    expect(await br.briefingLesen(leiter, "d1")).toEqual({ ok: false, code: "BRIEFING_NICHT_FREI" });

    absender.mockResolvedValue(null);
    const r = await fg.briefingFreigeben("w1", "d1", { whatsapp: true }, "u1", deps());
    expect(senden).not.toHaveBeenCalled();
    expect(r.ok && r.stand.team.map((p) => p.versand?.status)).toEqual(["kein_absender", "kein_absender", "kein_telefon"]);
  });

  it("Versandfehler einer Person stoppt die anderen nicht", async () => {
    senden.mockRejectedValueOnce(new Error("nicht verbunden")).mockResolvedValue({ externalMessageId: "m2" });
    await new Promise((r) => setTimeout(r, 5));
    const r = await fg.briefingFreigeben("w1", "d1", { whatsapp: true }, "u1", deps());
    expect(r.ok && r.stand.team.map((p) => p.versand?.status)).toEqual(["fehler", "gesendet", "kein_telefon"]);
  });
});

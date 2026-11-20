import postgres from "postgres";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CrewJob } from "@/lib/crew/contract";
import type { CrewKontext } from "./auth";
import { crewTestSchemaAnlegen, wertSetzen } from "./testdb";

/**
 * Echter Jobs-Lader, Antwort unter Sperre und Fotos gegen die Wegwerf-Postgres
 * (EINSATZ_TEST_DATABASE_URL). „Heute“ ist fest 2026-11-16 (Berlin).
 */
const url = process.env.EINSATZ_TEST_DATABASE_URL;
const h = vi.hoisted(() => ({ schema: `crewjobs_${Date.now().toString(36)}` }));

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.EINSATZ_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", {
    max: 6,
    onnotice: () => {},
    connection: { search_path: h.schema },
  });
  return { db: drizzle(client, { schema }) };
});

const jetzt = new Date("2026-11-16T10:00:00Z");
const ich: CrewKontext = {
  workspaceId: "w1",
  linkId: "l1",
  employee: { id: "e1", name: "Ali Kaya", locale: "de", canDriveSprinter: false, rateWorkCents: 2000, rateDriveCents: 1500 },
};
const GEHEIM = ["Familie Geheim", "0170 9998887", "4711", "Hauptstraße", "Calw"];

describe.skipIf(!url)("Crew-Jobs, Antwort und Fotos (DB)", { timeout: 30_000 }, () => {
  let sql: postgres.Sql;
  let jobs: typeof import("./jobs");
  let antwort: typeof import("./antwort");
  let fotos: typeof import("./fotos");
  const A: Record<string, string> = {};

  /** Deal mit Stufe, Termin, Firma über Auftrag und optionalen Werten anlegen. */
  async function deal(
    id: string,
    o: {
      stufe?: string;
      datum?: string;
      firma?: string | null;
      wc?: number | null;
      aus?: boolean;
      von?: unknown;
      geloescht?: boolean;
    } = {},
  ) {
    await sql`INSERT INTO records (id, object_id, deleted_at) VALUES (${id}, 'od', ${o.geloescht ? new Date() : null})`;
    await wertSetzen(sql, id, A.stage!, { text: o.stufe ?? "st_booked" });
    if (o.datum !== undefined) await wertSetzen(sql, id, A.move_date!, { datum: o.datum });
    await wertSetzen(sql, id, A.name!, { text: "Familie Geheim" });
    await wertSetzen(sql, id, A.customer_phone!, { text: "0170 9998887" });
    await wertSetzen(sql, id, A.value!, { zahl: 4711 });
    if (o.von !== undefined) await wertSetzen(sql, id, A.move_from_address!, { json: o.von });
    const au = `au_${id}`;
    await sql`INSERT INTO records (id, object_id) VALUES (${au}, 'oa')`;
    await wertSetzen(sql, au, A.a_deal!, { ref: id });
    if (o.firma !== null) await wertSetzen(sql, au, A.a_operating_company!, { ref: o.firma ?? "k1" });
    if (o.wc !== null) await wertSetzen(sql, au, A.worker_count!, { zahl: o.wc ?? 2 });
    if (o.aus !== undefined) await wertSetzen(sql, au, A.crew_ausschreiben!, { ja: o.aus });
    await wertSetzen(sql, au, A.load_unload_minutes!, { zahl: 300 });
  }

  beforeAll(async () => {
    sql = postgres(url!, { max: 1, onnotice: () => {} });
    await crewTestSchemaAnlegen(sql, h.schema);
    await sql.unsafe(`
      INSERT INTO workspaces VALUES ('w1');
      INSERT INTO objects VALUES ('od', 'w1', 'deals'), ('oa', 'w1', 'auftraege'), ('oc', 'w1', 'operating_companies');
      INSERT INTO employees (id, workspace_id, name) VALUES ('e1', 'w1', 'Ali Kaya'), ('e2', 'w1', 'Ben Bauer'), ('e3', 'w1', 'Cem Can');
    `);
    for (const [obj, slugs] of [
      ["od", ["stage", "move_date", "operating_company", "move_from_address", "move_to_address", "floors_from", "floors_to", "elevator_from", "elevator_to", "moving_lead_payload", "name", "customer_phone", "value"]],
      ["oa", ["deal", "operating_company", "worker_count", "crew_ausschreiben", "time_window_start", "time_window_end", "transporter", "load_unload_minutes", "drive_minutes_total"]],
      ["oc", ["name"]],
    ] as const) {
      for (const s of slugs) {
        const id = `${obj}_${s}`;
        await sql`INSERT INTO attributes VALUES (${id}, ${obj}, ${s})`;
        A[obj === "oa" && (s === "deal" || s === "operating_company") ? `a_${s}` : obj === "oc" ? `c_${s}` : s] = id;
      }
    }
    await sql`INSERT INTO statuses VALUES ('st_booked', ${A.stage!}, 'booked'), ('st_lost', ${A.stage!}, 'lost'), ('st_quoted', ${A.stage!}, 'quoted'), ('st_done', ${A.stage!}, 'done_unpaid'), ('st_kontakt', ${A.stage!}, 'open_engaged'), ('st_neu', ${A.stage!}, 'open_new')`;
    for (const [id, name] of [["k1", "Kottke-Umzüge"], ["c1", "Ceylan Operations"], ["x1", "Andere GmbH"]]) {
      await sql`INSERT INTO records (id, object_id) VALUES (${id}, 'oc')`;
      await wertSetzen(sql, id!, A.c_name!, { text: name });
    }

    await deal("dA", { datum: "2026-11-20", von: { line1: "Hauptstraße 5", postcode: "70176", city: "Stuttgart" } });
    await deal("dRuempel", { datum: "2026-11-21", firma: "c1", von: { line1: "Hauptstraße", city: "Tübingen" } });
    await deal("dStrasse", { datum: "2026-11-21", von: { line1: "Hauptstraße" } });
    await deal("dLine1Ort", { datum: "2026-11-21", von: { line1: "Calw" } });
    await deal("dPlz", { datum: "2026-11-22", von: { line1: "Rosenweg 3", postalCode: "72070" } });
    await deal("dAus", { datum: "2026-11-22", aus: false });
    await deal("dVorbei", { datum: "2026-11-10" });
    await deal("dQuoted", { datum: "2026-11-25", stufe: "st_quoted" });
    await deal("dFremd", { datum: "2026-11-25", firma: "x1" });
    await deal("dOhneZahl", { datum: "2026-11-25", wc: null });
    // Ohne Zahl am Auftrag gilt die Teamgröße der maßgeblichen Kalkulation (gesperrt vor neuer).
    await deal("dKalk", { datum: "2026-11-26", wc: null });
    // Noch nicht gebucht: Gespräch ohne Zahl sichtbar (nicht fix), neue Anfrage nicht.
    await deal("dKontakt", { datum: "2026-11-27", stufe: "st_kontakt", wc: null });
    await deal("dNeu", { datum: "2026-11-27", stufe: "st_neu" });
    // Ausdrücklich 0 am Auftrag: bleibt verborgen, auch wenn die Kalkulation Leute hat.
    await deal("dNull", { datum: "2026-11-26", wc: 0 });
    await sql.unsafe(`INSERT INTO deal_calculation_versions (workspace_id, deal_record_id, status, version, rechner_result) VALUES
      ('w1', 'dKalk', 'gesperrt', 1, '{"team":{"groesse":3}}'), ('w1', 'dKalk', 'entwurf', 2, '{"team":{"groesse":6}}'),
      ('w1', 'dA', 'gesperrt', 1, '{"team":{"groesse":5}}'), ('w1', 'dNull', 'gesperrt', 1, '{"team":{"groesse":4}}')`);
    await deal("dWeg", { datum: "2026-11-25", geloescht: true });
    await deal("dMeinGestern", { datum: "2026-11-15", stufe: "st_done", von: { line1: "Mühlweg 7", line2: "3. OG", postcode: "70173", city: "Stuttgart" } });
    await sql`INSERT INTO deal_employees (deal_record_id, employee_id, role, planned_work_minutes, planned_drive_minutes) VALUES ('dMeinGestern', 'e1', 'lead', 240, 60)`;
    await deal("dVerloren", { datum: "2026-11-25", stufe: "st_lost" });
    await sql`INSERT INTO crew_job_responses (id, workspace_id, deal_record_id, employee_id, answer) VALUES ('r0', 'w1', 'dVerloren', 'e1', 'ja')`;
    // Datumswahl im Portal schlägt move_date.
    await deal("dWahl", { datum: "2026-11-01" });
    await sql`INSERT INTO customer_date_selections (workspace_id, deal_record_id, selected_date) VALUES ('w1', 'dWahl', '2026-11-30')`;

    jobs = await import("./jobs");
    antwort = await import("./antwort");
    fotos = await import("./fotos");
  }, 60_000);

  afterAll(async () => {
    await sql?.unsafe(`DROP SCHEMA ${h.schema} CASCADE`);
    await sql?.end();
  });

  describe("Jobs-Lader", () => {
    it("Regeln A und B in SQL und Code: genau die richtigen Jobs, sortiert, vertragskonform", async () => {
      const liste = await jobs.ladeCrewJobs(ich, { jetzt });
      expect(liste.map((j) => j.id)).toEqual(["dMeinGestern", "dA", "dLine1Ort", "dRuempel", "dStrasse", "dPlz", "dQuoted", "dKalk", "dKontakt", "dWahl"]);
      const fix = Object.fromEntries(liste.map((j) => [j.id, j.fix]));
      expect(fix).toMatchObject({ dA: true, dMeinGestern: true, dQuoted: false, dKontakt: false, dKalk: true });
      // Auftrag schlägt Kalkulation; ohne Auftragszahl die gesperrte Version.
      expect(liste.find((j) => j.id === "dA")!.need).toBe(2);
      expect(liste.find((j) => j.id === "dKalk")!.need).toBe(3);
      for (const j of liste) expect(CrewJob.strict().parse(j)).toEqual(j);
      expect(liste.find((j) => j.id === "dWahl")!.date).toBe("2026-11-30");
      expect(liste.find((j) => j.id === "dRuempel")!.company).toBe("ruempeltuerken");
    });

    it("Datensparsamkeit: kein Kundenname, keine Kundennummer, kein Preis, keine Straße bei Unbestätigten", async () => {
      const liste = await jobs.ladeCrewJobs(ich, { jetzt });
      const offen = liste.filter((j) => j.my.status !== "bestaetigt");
      const text = JSON.stringify(offen);
      for (const g of GEHEIM) expect(text).not.toContain(g);
      for (const j of offen) expect(j.address).toBeNull();
      expect(JSON.stringify(liste)).not.toMatch(/Familie|0170|4711/);
    });

    it("Ort nur aus city, sonst PLZ, nie Straßentext", async () => {
      const lage = Object.fromEntries((await jobs.ladeCrewJobs(ich, { jetzt })).map((j) => [j.id, [j.town, j.district]]));
      expect(lage.dA).toEqual(["Stuttgart", "70176"]);
      expect(lage.dRuempel).toEqual(["Tübingen", null]);
      expect(lage.dStrasse).toEqual(["", null]);
      expect(lage.dLine1Ort).toEqual(["", null]);
      expect(lage.dPlz).toEqual(["72070", null]);
    });

    it("Bestätigt: volle Abholadresse, Lead, geplante Minuten im Lohn", async () => {
      const j = (await jobs.ladeCrewJobs(ich, { jetzt })).find((x) => x.id === "dMeinGestern")!;
      expect(j.my.status).toBe("bestaetigt");
      expect(j.address).toBe("Mühlweg 7, 3. OG, 70173 Stuttgart");
      expect(j.isLead).toBe(true);
      expect(j.pay).toMatchObject({ workMinutes: 240, driveMinutes: 60 });
      // Schnellschätzung im Auftrag (300 Min.) zählt nie als Lohn: ohne Plan und Kalkulation „Dauer noch offen“.
      expect((await jobs.ladeCrewJobs(ich, { jetzt })).find((x) => x.id === "dA")!.pay).toBeNull();
      expect(j.crew).toEqual([{ firstName: "Ali", initials: "AK", role: "lead", isMe: true, color: expect.stringMatching(/^[0-9a-f]{6}$/) }]);
    });

    it("Einzeljob (dealIds) baut nur diesen, prüft aber dieselben Regeln", async () => {
      expect((await jobs.ladeCrewJobs(ich, { jetzt, dealIds: ["dA"] })).map((j) => j.id)).toEqual(["dA"]);
      for (const d of ["dAus", "dVorbei", "dNeu", "dNull", "dFremd", "dOhneZahl", "dWeg", "dVerloren"]) {
        expect(await jobs.ladeCrewJobs(ich, { jetzt, dealIds: [d] })).toEqual([]);
        expect(await jobs.dealSichtbar(ich, d, { jetzt })).toBeNull();
      }
    });
  });

  describe("Antwort unter Sperre", () => {
    const meine = async (d: string) =>
      ((await sql`SELECT answer FROM crew_job_responses WHERE deal_record_id = ${d} AND employee_id = 'e1'`)[0]?.answer as string | undefined) ?? null;

    it("ja, Konflikt am Tag beim anderen Job, null nimmt zurück", async () => {
      const r = await antwort.antwortSetzen(ich, "dRuempel", "ja", { jetzt });
      expect(r.ok && r.job.my.status).toBe("ja");
      const liste = await jobs.ladeCrewJobs(ich, { jetzt });
      expect(liste.find((j) => j.id === "dStrasse")!.conflictSameDay).toBe(true);
      expect(liste.find((j) => j.id === "dRuempel")!.conflictSameDay).toBe(false);
      // Einzeljob kennt den Konflikt auch.
      const [einzeln] = await jobs.ladeCrewJobs(ich, { jetzt, dealIds: ["dStrasse"] });
      expect(einzeln!.conflictSameDay).toBe(true);
      const z = await antwort.antwortSetzen(ich, "dRuempel", null, { jetzt });
      expect(z.ok && z.job.my.status).toBe("offen");
      expect(await meine("dRuempel")).toBeNull();
    });

    it("eingeteilt → 409; ja auf vollen Job → warteliste", async () => {
      expect(await antwort.antwortSetzen(ich, "dMeinGestern", "nein", { jetzt })).toEqual({ ok: false, code: "BEREITS_BESTAETIGT" });
      await sql`INSERT INTO deal_employees (deal_record_id, employee_id) VALUES ('dPlz', 'e2'), ('dPlz', 'e3')`;
      const r = await antwort.antwortSetzen(ich, "dPlz", "ja", { jetzt });
      expect(r.ok && r.job.my.status).toBe("warteliste");
      expect(r.ok && r.job.full).toBe(true);
    });

    it("noch nicht fix: ja bleibt ja (keine Warteliste), Job nie voll", async () => {
      await sql`INSERT INTO deal_employees (deal_record_id, employee_id) VALUES ('dQuoted', 'e2'), ('dQuoted', 'e3')`;
      const r = await antwort.antwortSetzen(ich, "dQuoted", "ja", { jetzt });
      expect(r.ok && r.job.my.status).toBe("ja");
      expect(r.ok && r.job.full).toBe(false);
      expect(r.ok && r.job.fix).toBe(false);
      // Alte Warteliste aus der Zeit als gebuchter Job zeigt sich als „ja“.
      await sql`UPDATE crew_job_responses SET answer = 'warteliste' WHERE deal_record_id = 'dQuoted' AND employee_id = 'e1'`;
      const [j] = await jobs.ladeCrewJobs(ich, { jetzt, dealIds: ["dQuoted"] });
      expect(j!.my.status).toBe("ja");
      await antwort.antwortSetzen(ich, "dQuoted", null, { jetzt });
      await sql`DELETE FROM deal_employees WHERE deal_record_id = 'dQuoted'`;
    });

    it("Zurücknehmen auf einem nur durch die Antwort sichtbaren Job liefert den Job ohne Antwort", async () => {
      await antwort.antwortSetzen(ich, "dA", "ja", { jetzt });
      await wertSetzen(sql, "au_dA", A.crew_ausschreiben!, { ja: false });
      const r = await antwort.antwortSetzen(ich, "dA", null, { jetzt });
      expect(r.ok && r.job.id).toBe("dA");
      expect(r.ok && r.job.my.status).toBe("offen");
      expect(await jobs.dealSichtbar(ich, "dA", { jetzt })).toBeNull();
      await sql`DELETE FROM record_values WHERE record_id = 'au_dA' AND attribute_id = ${A.crew_ausschreiben!}`;
    });

    /** Hält die Sperre des Deals in einer zweiten Verbindung, ändert dort und gibt erst dann frei. */
    async function mitSperre(d: string, aenderung: (tx: postgres.Sql) => Promise<void>, waehrend: () => Promise<unknown>) {
      const zweite = postgres(url!, { max: 1, onnotice: () => {}, connection: { search_path: h.schema } });
      let laeuft: Promise<unknown> | null = null;
      await zweite.begin(async (transaktion) => {
        // TransactionSql verliert in den Typen die Aufrufsignatur (postgres.js); zur Laufzeit gleich.
        const tx = transaktion as unknown as postgres.Sql;
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`einsatz:deal:${d}`}, 0))`;
        laeuft = waehrend();
        await new Promise((r) => setTimeout(r, 300));
        await aenderung(tx);
      });
      await zweite.end();
      return laeuft!;
    }

    it("gleichzeitig zurückgezogen (Ausschreiben aus): Antwort wartet auf die Sperre und bekommt 404", async () => {
      const r = await mitSperre(
        "dLine1Ort",
        async (tx) => {
          await tx`INSERT INTO record_values (record_id, attribute_id, boolean_value) VALUES ('au_dLine1Ort', ${A.crew_ausschreiben!}, false)`;
        },
        () => antwort.antwortSetzen(ich, "dLine1Ort", "ja", { jetzt }),
      );
      expect(r).toEqual({ ok: false, code: "JOB_NICHT_SICHTBAR" });
      expect(await meine("dLine1Ort")).toBeNull();
    });

    it("gleichzeitig voll geworden: Antwort sieht die neue Zahl und speichert warteliste", async () => {
      const r = (await mitSperre(
        "dStrasse",
        async (tx) => {
          await tx`INSERT INTO deal_employees (deal_record_id, employee_id) VALUES ('dStrasse', 'e2'), ('dStrasse', 'e3')`;
        },
        () => antwort.antwortSetzen(ich, "dStrasse", "ja", { jetzt }),
      )) as { ok: boolean };
      expect(r.ok).toBe(true);
      expect(await meine("dStrasse")).toBe("warteliste");
    });

    it("gleichzeitig Anzahl erhöht: Antwort sieht Platz und speichert ja", async () => {
      await sql`INSERT INTO deal_employees (deal_record_id, employee_id) VALUES ('dWahl', 'e2'), ('dWahl', 'e3')`;
      await mitSperre(
        "dWahl",
        async (tx) => {
          await tx`UPDATE record_values SET number_value = 3 WHERE record_id = 'au_dWahl' AND attribute_id = ${A.worker_count!}`;
        },
        () => antwort.antwortSetzen(ich, "dWahl", "ja", { jetzt }),
      );
      expect(await meine("dWahl")).toBe("ja");
    });
  });

  describe("Fotos", () => {
    let jpegMitExif: string;

    beforeAll(async () => {
      jpegMitExif = (
        await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 100, b: 50 } } })
          .jpeg()
          .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "Kunde Geheim", Make: "Kamera" } } })
          .toBuffer()
      ).toString("base64");
      await sql`INSERT INTO inbox_message_attachments (id, workspace_id, deal_record_id, mime_type, file_content) VALUES
        ('f1', 'w1', 'dRuempel', 'image/jpeg', ${jpegMitExif}),
        ('f2', 'w1', 'dRuempel', 'image/jpeg', ${jpegMitExif}),
        ('fHeic', 'w1', 'dRuempel', 'image/heic', 'AAAA'),
        ('fZu', 'w1', 'dAus', 'image/jpeg', ${jpegMitExif}),
        ('fGross', 'w1', 'dRuempel', 'image/jpeg', ${"A".repeat(21 * 1024 * 1024)})`;
      for (const [f, d] of [["f1", "dRuempel"], ["f2", "dRuempel"], ["fZu", "dAus"], ["fGross", "dRuempel"]] as const) {
        expect((await fotos.crewFotoFreigeben("w1", d, f, true, "u1")).ok).toBe(true);
      }
    });

    it("Freigabe: HEIC abgelehnt (Format), falscher Deal nicht gefunden, Zurücknehmen geht", async () => {
      expect(await fotos.crewFotoFreigeben("w1", "dRuempel", "fHeic", true, "u1")).toEqual({ ok: false, code: "FORMAT" });
      expect(await fotos.crewFotoFreigeben("w1", "dA", "f1", true, "u1")).toEqual({ ok: false, code: "NICHT_GEFUNDEN" });
      expect((await sql`SELECT crew_freigegeben_at FROM inbox_message_attachments WHERE id = 'fHeic'`)[0]!.crew_freigegeben_at).toBeNull();
    });

    it("Liste zeigt nur freigegebene Fotos sichtbarer Jobs", async () => {
      const j = (await jobs.ladeCrewJobs(ich, { jetzt })).find((x) => x.id === "dRuempel")!;
      expect(j.photos.map((p) => p.id)).toEqual(["f1", "f2", "fGross"]);
    });

    it("Auslieferung: WebP, ohne EXIF, gedreht und auf 1000 px begrenzt", async () => {
      const r = await fotos.crewFotoLaden(ich, "f1", { jetzt });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.contentType).toBe("image/webp");
      expect(r.body.byteLength).toBeLessThan(4 * 1024 * 1024);
      const m = await sharp(r.body).metadata();
      expect(m.format).toBe("webp");
      expect(m.exif).toBeUndefined();
      expect(m.orientation ?? 1).toBe(1);
      // 3000 × 2000 mit Ausrichtung 6 → hochkant 2000 × 3000 → 667 × 1000.
      expect([m.width, m.height]).toEqual([667, 1000]);
      expect(Buffer.from(r.body).toString("latin1")).not.toContain("Kunde Geheim");
    });

    it("nicht freigegeben, Job unsichtbar, zu groß, unbekannt → nichts", async () => {
      expect((await fotos.crewFotoLaden(ich, "fHeic", { jetzt })).ok).toBe(false);
      expect((await fotos.crewFotoLaden(ich, "fZu", { jetzt })).ok).toBe(false);
      expect((await fotos.crewFotoLaden(ich, "fGross", { jetzt })).ok).toBe(false);
      expect((await fotos.crewFotoLaden(ich, "gibtsnicht", { jetzt })).ok).toBe(false);
      expect((await fotos.crewFotoLaden(ich, "../f1", { jetzt })).ok).toBe(false);
    });

    it("zwischen Prüfung und Lesen umgehängt: das Lesen liefert nichts", async () => {
      const f = await fotos.freigegebenesFoto("w1", "f2");
      expect(f).toMatchObject({ tabelle: "chat", dealId: "dRuempel" });
      await sql`UPDATE inbox_message_attachments SET deal_record_id = 'dAus' WHERE id = 'f2'`;
      expect(await fotos.fotoQuelleLesen("w1", "f2", f!.dealId, f!.tabelle)).toBeNull();
      expect(await fotos.fotoQuelleLesen("w1", "f2", f!.dealId, f!.tabelle, false)).toBeNull();
      expect((await fotos.crewFotoLaden(ich, "f2", { jetzt })).ok).toBe(false);
      // Freigabe am alten Deal greift nicht mehr.
      expect(await fotos.crewFotoFreigeben("w1", "dRuempel", "f2", false, "u1")).toEqual({ ok: false, code: "NICHT_GEFUNDEN" });
    });

    it("zurückgezogene Freigabe: auch ein gemerktes Foto geht nicht mehr raus", async () => {
      expect((await fotos.crewFotoLaden(ich, "f1", { jetzt })).ok).toBe(true);
      await fotos.crewFotoFreigeben("w1", "dRuempel", "f1", false, "u1");
      expect((await fotos.crewFotoLaden(ich, "f1", { jetzt })).ok).toBe(false);
    });
  });
});

import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { KvAenderung, KvBasis, KvFeld, KvGrundlageVps } from "@/lib/kv-editor";

/**
 * KV-Editor, Dienst und Haken gegen eine echte Postgres-DB (Plan Aufgabe 3, Spec 12, Review-Abgleich):
 * Erstaufrufe parallel, zwei Speichervorgänge parallel, Entwurf nie in `deal_documents`, Push während
 * eines laufenden Drucks, Annahme mit und ohne Admin, Mitwandern über zwei Versionen, KI-Herkunft und
 * der normale KV-Weg ohne Editor (VPS und CRM). Läuft nur mit KV_EDITOR_TEST_DATABASE_URL (Wegwerf-DB
 * mit Schema inkl. 0071, nie Neon). Kein VPS, keine KI: Paket, Start und KI sind Fakes; der CRM-Renderer
 * ist echt (wie in `commercial-documents-kv.db.test.ts`).
 */
const url = process.env.KV_EDITOR_TEST_DATABASE_URL;
const stand = vi.hoisted(() => ({ deal: "", firma: "" }));

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const pg = (await import("postgres")).default;
  const schema = await import("@/db/schema");
  const client = pg(process.env.KV_EDITOR_TEST_DATABASE_URL ?? "postgres://ungenutzt@127.0.0.1:1/x", { max: 6 });
  return { db: drizzle(client, { schema }), __client: client };
});
vi.mock("./activity-events", () => ({ emitEvent: async () => {} }));
vi.mock("./wartet", () => ({ aktualisiereWartet: async () => {}, aktualisiereWartetNachBesuch: async () => {} }));
vi.mock("./customer-portal-notifications", () => ({ maybeNotifyPortalEvent: async () => {} }));
vi.mock("./deal-attribution", () => ({ advanceDealToQuotedIfEarlier: async () => {} }));
vi.mock("@/services/records", () => ({
  getRecord: async (_o: string, id: string) =>
    id === stand.deal
      ? { values: { name: "Umzug Beispiel", operating_company: { id: stand.firma, displayName: "Ceylan Umzüge" }, move_date: "2026-12-15" } }
      : { values: { name: "Ceylan Umzüge" } },
}));
vi.mock("@/services/doc-customer-name", () => ({
  resolveDocCustomerName: async () => ({ vorname: "Mira", nachname: "Beispiel", fullName: "Mira Beispiel", source: "person" }),
}));
vi.mock("@/services/customer-portal-emails", () => ({ loadCustomerEmail: async () => null }));
vi.mock("@/services/agent/agent-suppress", () => ({ ladeGespeicherteAnrede: async () => ({}), anredeFuerOptOut: () => "sie" }));

const PDF = Buffer.from("%PDF-1.7\nTest\n");

describe.skipIf(!url)("KV-Editor Dienst (DB, Aufgabe 3)", { timeout: 60_000 }, () => {
  let sql: postgres.Sql;
  let dienst: typeof import("./kv-editor");
  let haken: typeof import("./kv-editor-haken");
  let ablage: typeof import("./kv-job-ablage");
  let jobs: typeof import("./render-jobs");
  let docs: typeof import("./commercial-documents");
  let dbMod: typeof import("@/db");
  const ws = randomUUID();
  const objDeals = randomUUID();
  const objFirmen = randomUUID();
  const attrFirma = randomUUID();
  const attrName = randomUUID();
  const firma = randomUUID();
  const dario = randomUUID();
  const nuri = randomUUID();
  let deal = "";
  let versionen: string[] = [];

  /** Basiswerte des Fake-VPS-Pakets (je Test änderbar). */
  let vpsWerte: Record<string, string> = {};
  let vpsStarts: string[] = [];
  let vpsSchranke: null | (() => Promise<void>) = null;
  const gemeldet = vi.fn(async () => {});
  const nachPush = vi.fn(async () => {});

  const feld = (schluessel: string, basis: string): KvFeld => ({
    schluessel,
    abschnitt: schluessel.startsWith("leistungen") ? "leistungen" : "vereinbarungen",
    label: schluessel,
    art: "langtext",
    max: 2000,
    basis,
  });
  const vpsBasis = (): KvBasis => ({ renderer: "vps", felder: Object.entries(vpsWerte).map(([s, b]) => feld(s, b)) });
  const versionJetzt = async () =>
    (await sql<{ v: string | null }[]>`select calculation_version_id as v from quotations where deal_record_id = ${deal}`)[0]?.v ?? null;

  /** Fakes für VPS (Paket, Start) und Lead; der CRM-Renderer bleibt echt. */
  const opt = (extra: Partial<import("./kv-editor").KvEditorOptionen> = {}): import("./kv-editor").KvEditorOptionen => ({
    dealKopf: async () => ({ kunde: "Mira Beispiel", firma: "kottke", firmaName: "Kottke Umzüge" }),
    ausgangGrundlageVps: async () => ({ bildIds: ["bild-1"] }),
    vpsPaket: async (_w, _d, grundlage: KvGrundlageVps, aenderungen) => {
      const basis = vpsBasis();
      const liste = aenderungen(basis);
      return {
        params: { document_type: "KV", grundlage, liste },
        basis,
        nurLesen: [{ name: "Klavier", raum: null }],
        calculationVersionId: await versionJetzt(),
        priceCents: 172000,
        kvPreise: { erwartetCent: [172000], erlaubtCent: [0] },
      };
    },
    vpsStarten: async () => {
      const id = randomUUID();
      vpsStarts.push(id);
      if (vpsSchranke) await vpsSchranke();
      return id;
    },
    druckAnstossen: async () => {},
    nachPush,
    annahmeGemeldet: gemeldet,
    ...extra,
  });

  const zaehlen = async () => {
    const [{ d }] = await sql<{ d: number }[]>`select count(*)::int as d from deal_documents where deal_record_id = ${deal}`;
    const [{ s }] = await sql<{ s: number }[]>`select count(*)::int as s from kv_staende where deal_record_id = ${deal}`;
    const [{ j }] = await sql<{ j: number }[]>`select count(*)::int as j from document_render_jobs where deal_record_id = ${deal}`;
    return { dokumente: d, staende: s, jobs: j };
  };

  /** Ein KV-Dokument wie ein Upload oder ein alter KV (ohne Stand). */
  const kvDokument = async (fileName: string, sekundenZurueck = 0) => {
    const id = randomUUID();
    await sql`insert into deal_documents (id, workspace_id, deal_record_id, document_type, file_name, file_size, mime_type, file_content, calculation_version_id, uploaded_at)
      values (${id}, ${ws}, ${deal}, 'quotation', ${fileName}, ${PDF.byteLength}, 'application/pdf', ${PDF.toString("base64")}, ${await versionJetzt()},
        now() - make_interval(secs => ${sekundenZurueck}))`;
    return id;
  };

  const versionSetzen = (i: number) => sql`update quotations set calculation_version_id = ${versionen[i]} where deal_record_id = ${deal}`;

  /** Druckt einen VPS-Job zu Ende wie der Cron (`ablegenUnterSperre`), Preis ok. */
  const vpsFertig = async (jobId: string, preis: "ok" | "abweichung" = "ok") => {
    const j = await jobs.jobReservieren(ws, jobId, new Date());
    expect(j).not.toBeNull();
    return ablage.ablegenUnterSperre(
      { ...j!, claimedAt: j!.claimedAt! },
      { fileName: "KV-KO-20261118-TEST.pdf", mimeType: "application/pdf", fileSize: PDF.byteLength, fileContent: PDF.toString("base64"), documentType: "quotation" },
      { pruefung: { erwartetCent: [172000], erlaubtCent: [0], preis, fehlt: [], fremd: preis === "ok" ? [] : [99900] } }
    );
  };

  /** Neuer VPS-KV aus der Kalkulation wie die Route `/api/tools/run` (Haken, Stand und Job in einer Transaktion). */
  const vpsKvAusKalkulation = async () => {
    const { abgleichen } = await import("@/lib/kv-editor-anwenden");
    const { quelle } = await haken.kvEditorBeimNeuenKv(ws, deal);
    const a = quelle ? abgleichen(vpsBasis(), quelle.aenderungen, quelle.offen) : { liste: [], konflikte: [] };
    const jobId = randomUUID();
    const v = await versionJetzt();
    await dbMod.db.transaction(async (tx) => {
      const s = await haken.kvEditorStandZumNeuenKv(tx, ws, deal, {
        renderer: "vps",
        grundlage: { bildIds: [] },
        aenderungen: a.liste,
        offen: a.konflikte,
        quelleId: quelle?.id ?? null,
        calculationVersionId: v,
        renderJobId: jobId,
        dealDocumentId: null,
        pruefung: { erwartetCent: [172000], erlaubtCent: [0], preis: "offen", fehlt: [], fremd: [] },
        userId: dario,
      });
      await jobs.jobAnlegen(
        { vpsJobId: jobId, workspaceId: ws, dealRecordId: deal, documentType: "quotation", calculationVersionId: v, priceCents: 172000, createdBy: dario, invoiceId: null, kvStandId: s.id, kvStandZiel: "aktuell" },
        tx
      );
    });
    return jobId;
  };

  const staende = async () =>
    sql<{ id: string; nummer: number; quelle: string; status: string; fehler: string | null; deal_document_id: string | null; vorgaenger_id: string | null; aenderungen: KvAenderung[]; offen: { status: string; art: string; aenderung: KvAenderung }[] }[]>`
      select id, nummer, quelle, status, fehler, deal_document_id, vorgaenger_id, aenderungen, offen from kv_staende where deal_record_id = ${deal} order by nummer`;

  beforeAll(async () => {
    sql = postgres(url!, { max: 3 });
    await sql`insert into workspaces (id, name, slug) values (${ws}, 'KV-Editor', ${`t-${ws}`})`;
    await sql`insert into users (id, name, email) values (${dario}, 'Dario', ${`d-${dario}@test.de`}), (${nuri}, 'Nuri', ${`n-${nuri}@test.de`})`;
    await sql`insert into objects (id, workspace_id, slug, singular_name, plural_name) values (${objDeals}, ${ws}, 'deals', 'Deal', 'Deals'), (${objFirmen}, ${ws}, 'operating_companies', 'Firma', 'Firmen')`;
    await sql`insert into attributes (id, object_id, slug, title, type) values
      (${attrFirma}, ${objDeals}, 'operating_company', 'Firma', 'record_reference'),
      (${attrName}, ${objFirmen}, 'name', 'Name', 'text')`;
    await sql`insert into records (id, object_id) values (${firma}, ${objFirmen})`;
    await sql`insert into record_values (id, record_id, attribute_id, text_value) values (${randomUUID()}, ${firma}, ${attrName}, 'Ceylan Umzüge')`;
    stand.firma = firma;
    dienst = await import("./kv-editor");
    haken = await import("./kv-editor-haken");
    ablage = await import("./kv-job-ablage");
    jobs = await import("./render-jobs");
    docs = await import("./commercial-documents");
    dbMod = await import("@/db");
  });

  beforeEach(async () => {
    vpsWerte = { "vereinbarungen:text:text": "", "leistungen:transport:notiz": "Basisnotiz" };
    vpsStarts = [];
    vpsSchranke = null;
    gemeldet.mockClear();
    nachPush.mockClear();
    deal = randomUUID();
    stand.deal = deal;
    await sql`insert into records (id, object_id) values (${deal}, ${objDeals})`;
    await sql`insert into record_values (id, record_id, attribute_id, referenced_record_id) values (${randomUUID()}, ${deal}, ${attrFirma}, ${firma})`;
    versionen = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (const [i, id] of versionen.entries()) {
      await sql`insert into deal_calculation_versions (id, workspace_id, deal_record_id, version, status, reference_date)
        values (${id}, ${ws}, ${deal}, ${i + 1}, 'gesperrt', '2026-11-07')`;
    }
    const q = randomUUID();
    await sql`insert into quotations (id, deal_record_id, is_variable, fixed_price, calculation_version_id)
      values (${q}, ${deal}, false, '900.00', ${versionen[0]})`;
    await sql`insert into quotation_line_items (id, quotation_id, type, description, quantity, unit_rate, sort_order)
      values (${randomUUID()}, ${q}, 'other', 'Umzug', 1, '900.00', 0)`;
  });

  afterAll(async () => {
    await sql`delete from workspaces where id = ${ws}`;
    await sql`delete from users where id in (${dario}, ${nuri})`;
    await sql?.end();
    await ((await import("@/db")) as unknown as { __client: postgres.Sql }).__client.end();
  });

  // ─── Erster Aufruf ─────────────────────────────────────────────────────────

  it("Erstinitialisierung parallel: genau ein Ausgangs-Stand mit Datei des neuesten KV (Grok 8, Kimi 19)", async () => {
    await kvDokument("KV-KO-20261101-ALT.pdf", 60);
    const neuest = await kvDokument("KV-KO-20261110-ART-3.pdf", 10);
    const ansichten = await Promise.all([1, 2, 3, 4].map(() => dienst.ansicht(ws, deal, { userId: dario, admin: false }, opt())));
    const s = await staende();
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ nummer: 1, quelle: "ausgang", status: "fertig", deal_document_id: neuest });
    const [row] = await sql`select renderer, grundlage, grundlage_rekonstruiert, file_content from kv_staende where id = ${s[0].id}`;
    expect(row).toMatchObject({ renderer: "vps", grundlage: { bildIds: ["bild-1"] }, grundlage_rekonstruiert: true, file_content: PDF.toString("base64") });
    for (const a of ansichten) {
      expect(a.hinweis).toBe("rekonstruiert");
      expect(a.aktuellStandId).toBe(s[0].id);
      expect(a.aktuellDokumentId).toBe(neuest);
      expect(a.annahme).toMatchObject({ aktiv: false, aufhebenErlaubt: false });
      expect(a.preis.text).toBe("Gesamtpreis 900 € aus Kalkulation v1");
    }
    // Ohne KV: kein Stand, Hinweis kein_kv.
    const leer = randomUUID();
    await sql`insert into records (id, object_id) values (${leer}, ${objDeals})`;
    const a = await dienst.ansicht(ws, leer, { userId: dario, admin: true }, opt());
    expect(a).toMatchObject({ hinweis: "kein_kv", staende: [], annahme: { aufhebenErlaubt: true } });
  });

  it("Upload von Hand nach Ständen: Hinweis quelle_ohne_stand, kein zweiter Ausgang, Haken liefert keine Quelle (Kimi 2)", async () => {
    await kvDokument("KV-KO-20261101-ALT.pdf", 60);
    await dienst.ansicht(ws, deal, { userId: dario, admin: false }, opt());
    await kvDokument("eigener-kv.pdf", 0);
    const a = await dienst.ansicht(ws, deal, { userId: dario, admin: false }, opt());
    expect(a.hinweis).toBe("quelle_ohne_stand");
    expect(a.staende).toHaveLength(1);
    expect((await haken.kvEditorBeimNeuenKv(ws, deal)).quelle).toBeNull();
    // Fremder Workspace sieht nichts.
    expect((await haken.kvEditorBeimNeuenKv(randomUUID(), deal)).quelle).toBeNull();
  });

  // ─── Speichern ─────────────────────────────────────────────────────────────

  it("VPS-Entwurf: Stand und Job (Ziel entwurf) atomar, fertig gedruckt nie in deal_documents", async () => {
    await kvDokument("KV-KO-20261110-ART-3.pdf");
    const a = await dienst.ansicht(ws, deal, { userId: dario, admin: false }, opt());
    const s1 = a.staende[0];
    const s2 = await dienst.standAnlegen(
      ws,
      deal,
      { vorgaengerId: s1.id, setzen: [{ schluessel: "vereinbarungen:text:text", wert: " Bitte beim Hausmeister klingeln. " }], zuruecksetzen: [] },
      dario,
      opt()
    );
    expect(s2).toMatchObject({ nummer: 2, quelle: "hand", status: "druckt", vorgaengerId: s1.id, erstelltVon: { id: dario, name: "Dario" } });
    expect(s2.aenderungen).toEqual([
      expect.objectContaining({ schluessel: "vereinbarungen:text:text", wert: "Bitte beim Hausmeister klingeln.", vorher: "", quelle: "hand", von: dario }),
    ]);
    const [job] = await sql`select kv_stand_id, kv_stand_ziel, status from document_render_jobs where vps_job_id = ${vpsStarts[0]}`;
    expect(job).toMatchObject({ kv_stand_id: s2.id, kv_stand_ziel: "entwurf", status: "laeuft" });
    expect(await zaehlen()).toEqual({ dokumente: 1, staende: 2, jobs: 1 });

    const r = await vpsFertig(vpsStarts[0]);
    expect(r).toEqual({ art: "entwurf", status: "fertig" });
    expect(await zaehlen()).toEqual({ dokumente: 1, staende: 2, jobs: 1 });
    const d = await dienst.standLesen(ws, deal, s2.id, opt());
    expect(d).toMatchObject({ status: "fertig", dealDocumentId: null, aktuell: false, nurLesen: [{ name: "Klavier", raum: null }] });
    expect(d.werte["vereinbarungen:text:text"]).toBe("Bitte beim Hausmeister klingeln.");
    expect(d.unterschied).toEqual([expect.objectContaining({ schluessel: "vereinbarungen:text:text", art: "neu", nachher: "Bitte beim Hausmeister klingeln." })]);
    const pdf = await dienst.standPdf(ws, deal, s2.id);
    expect(pdf?.bytes.equals(PDF)).toBe(true);
  });

  it("Abfrage druckender Stände (schlank): nur Kopf, stößt den Abschluss an, baut keine Basis, fremder Workspace KEIN_KV", async () => {
    await kvDokument("KV-KO-20261110-ART-3.pdf");
    const s1 = (await dienst.ansicht(ws, deal, { userId: dario, admin: false }, opt())).staende[0];
    const s2 = await dienst.standAnlegen(
      ws,
      deal,
      { vorgaengerId: s1.id, setzen: [{ schluessel: "vereinbarungen:text:text", wert: "Hausmeister" }], zuruecksetzen: [] },
      dario,
      opt()
    );
    const paket = vi.fn();
    const ohneBasis = opt({
      vpsPaket: async () => {
        paket();
        throw new Error("Basis darf hier nicht gebaut werden");
      },
      crmBasis: async () => {
        paket();
        throw new Error("Basis darf hier nicht gebaut werden");
      },
    });
    // Noch im Druck: Abschluss angestoßen (Fake tut nichts), Status bleibt.
    const angestossen: string[] = [];
    const k1 = await dienst.standKopfLesen(ws, deal, s2.id, { ...ohneBasis, druckAnstossen: async (_w, id) => void angestossen.push(id) });
    expect(k1).toMatchObject({ id: s2.id, status: "druckt", nummer: 2 });
    expect(angestossen).toEqual([vpsStarts[0]]);
    // Anstoßen schließt den Druck ab (wie der Cron); der Kopf liest danach neu.
    const k2 = await dienst.standKopfLesen(ws, deal, s2.id, { ...ohneBasis, druckAnstossen: async (_w, id) => void (await vpsFertig(id)) });
    expect(k2).toMatchObject({ id: s2.id, status: "fertig", aktuell: false, dealDocumentId: null, pruefung: expect.objectContaining({ preis: "ok" }) });
    expect(paket).not.toHaveBeenCalled();
    // Fertig: kein weiteres Anstoßen.
    const nochmal = vi.fn(async () => {});
    await dienst.standKopfLesen(ws, deal, s2.id, { ...ohneBasis, druckAnstossen: nochmal });
    expect(nochmal).not.toHaveBeenCalled();
    await expect(dienst.standKopfLesen(randomUUID(), deal, s2.id, ohneBasis)).rejects.toMatchObject({ code: "KEIN_KV", status: 404 });
    await expect(dienst.standKopfLesen(ws, deal, "", ohneBasis)).rejects.toMatchObject({ code: "KEIN_KV" });
  });

  it("Preisverdacht und unbekannte Felder: 400 UNGUELTIG, kein Druck, kein Stand", async () => {
    await kvDokument("KV-KO-20261110-ART-3.pdf");
    const s1 = (await dienst.ansicht(ws, deal, { userId: dario, admin: false }, opt())).staende[0];
    await expect(
      dienst.standAnlegen(
        ws,
        deal,
        { vorgaengerId: s1.id, setzen: [{ schluessel: "vereinbarungen:text:text", wert: "20 % Rabatt" }, { schluessel: "preise:x:y", wert: "1" }], zuruecksetzen: [] },
        dario,
        opt()
      )
    ).rejects.toMatchObject({ code: "UNGUELTIG", status: 400, daten: { abgelehnt: [{ schluessel: "vereinbarungen:text:text", grund: "PREIS" }, { schluessel: "preise:x:y", grund: "UNBEKANNT" }] } });
    expect(vpsStarts).toHaveLength(0);
    expect((await zaehlen()).staende).toBe(1);
    // Postleitzahl und Telefon gehen durch (Entscheidung Koordinator).
    const s2 = await dienst.standAnlegen(
      ws,
      deal,
      { vorgaengerId: s1.id, setzen: [{ schluessel: "vereinbarungen:text:text", wert: "Hausmeister 0711 / 123456, Zufahrt über 70173" }], zuruecksetzen: [] },
      dario,
      opt()
    );
    expect(s2.status).toBe("druckt");
  });

  it("zwei gleichzeitige Speichervorgänge: einer gewinnt, der andere 409 STAND_VERALTET, sein VPS-Job bleibt unregistriert", async () => {
    await kvDokument("KV-KO-20261110-ART-3.pdf");
    const s1 = (await dienst.ansicht(ws, deal, { userId: dario, admin: false }, opt())).staende[0];
    let da = 0;
    let los: () => void = () => {};
    const beide = new Promise<void>((r) => (los = r));
    vpsSchranke = async () => {
      da += 1;
      if (da === 2) los();
      await beide;
    };
    const speichern = (wert: string, wer: string) =>
      dienst.standAnlegen(ws, deal, { vorgaengerId: s1.id, setzen: [{ schluessel: "vereinbarungen:text:text", wert }], zuruecksetzen: [] }, wer, opt());
    const r = await Promise.allSettled([speichern("Erste Fassung", dario), speichern("Zweite Fassung", nuri)]);
    const ok = r.filter((x) => x.status === "fulfilled");
    const nein = r.filter((x): x is PromiseRejectedResult => x.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(nein).toHaveLength(1);
    expect(nein[0].reason).toMatchObject({ code: "STAND_VERALTET", status: 409, daten: { neuester: { nummer: 2 } } });
    expect(vpsStarts).toHaveLength(2);
    const registriert = await sql`select vps_job_id from document_render_jobs where deal_record_id = ${deal}`;
    expect(registriert).toHaveLength(1);
    expect(await zaehlen()).toEqual({ dokumente: 1, staende: 2, jobs: 1 });
  });

  it("CRM-Entwurf (echter Renderer): fertig, PDF im Stand, nie in deal_documents", async () => {
    await docs.storeCommercialDocument({ workspaceId: ws, dealRecordId: deal, kind: "KV" });
    const s1 = (await staende())[0];
    const o = opt({ dealKopf: async () => ({ kunde: "Mira Beispiel", firma: "ceylan", firmaName: "Ceylan Umzüge" }) });
    const s2 = await dienst.standAnlegen(
      ws,
      deal,
      { vorgaengerId: s1.id, setzen: [{ schluessel: "bemerkungen:text:text", wert: "Parken im Hof ist abgesprochen." }], zuruecksetzen: [] },
      dario,
      o
    );
    expect(s2).toMatchObject({ renderer: "crm", status: "fertig", quelle: "hand", dealDocumentId: null, kalkulationVersion: 1 });
    expect(await zaehlen()).toEqual({ dokumente: 1, staende: 2, jobs: 0 });
    const d = await dienst.standLesen(ws, deal, s2.id, o);
    expect(d.basis.renderer).toBe("crm");
    expect(d.werte["bemerkungen:text:text"]).toBe("Parken im Hof ist abgesprochen.");
    const pdf = await dienst.standPdf(ws, deal, s2.id);
    expect(pdf?.bytes.subarray(0, 5).toString()).toBe("%PDF-");
  });

  // ─── Pushen ────────────────────────────────────────────────────────────────

  it("Push während eines laufenden Drucks: druckender Stand nicht pushbar; älterer KV-Job nach dem Push verworfen (Kimi 1)", async () => {
    await kvDokument("KV-KO-20261110-ART-3.pdf");
    const a = await dienst.ansicht(ws, deal, { userId: dario, admin: false }, opt());
    const s1 = a.staende[0];
    const entwurf = await dienst.standAnlegen(
      ws,
      deal,
      { vorgaengerId: s1.id, setzen: [{ schluessel: "leistungen:transport:notiz", wert: "Schrank zuerst" }], zuruecksetzen: [] },
      dario,
      opt()
    );
    // Noch im Druck: nicht pushbar.
    await expect(
      dienst.pushen(ws, deal, entwurf.id, { erwartetAktuellDokumentId: a.aktuellDokumentId }, { userId: dario, admin: false }, opt())
    ).rejects.toMatchObject({ code: "STAND_NICHT_FERTIG", daten: { status: "druckt" } });
    await vpsFertig(vpsStarts[0]);

    // Ein normaler KV aus der Kalkulation startet (Quelle Stand 1) und läuft noch.
    const laufend = await vpsKvAusKalkulation();
    const pushed = await dienst.pushen(ws, deal, entwurf.id, { erwartetAktuellDokumentId: a.aktuellDokumentId }, { userId: nuri, admin: false }, opt());
    expect(pushed.annahmeAufgehoben).toBe(false);
    expect(pushed.stand).toMatchObject({ aktuell: true, gepushtVon: { id: nuri, name: "Nuri" }, dealDocumentId: pushed.dealDocumentId });
    expect(nachPush).toHaveBeenCalledTimes(1);

    const r = await vpsFertig(laufend);
    expect(r).toMatchObject({ art: "verworfen", text: `Inzwischen wurde Stand ${entwurf.nummer} gepusht. KV neu erstellen, die Änderungen wandern mit.` });
    const s = await staende();
    expect(s.find((x) => x.nummer === 3)).toMatchObject({ quelle: "neu", status: "fehler", deal_document_id: null, vorgaenger_id: s1.id });
    expect(await zaehlen()).toMatchObject({ dokumente: 2 });
    const [akt] = await sql`select id from deal_documents where deal_record_id = ${deal} order by uploaded_at desc limit 1`;
    expect(akt.id).toBe(pushed.dealDocumentId);

    // Zweiter Push desselben Stands, alter Erwartungswert, älterer Stand.
    await expect(
      dienst.pushen(ws, deal, entwurf.id, { erwartetAktuellDokumentId: pushed.dealDocumentId }, { userId: nuri, admin: false }, opt())
    ).rejects.toMatchObject({ code: "UNGUELTIG" });
    await expect(
      dienst.pushen(ws, deal, s1.id, { erwartetAktuellDokumentId: a.aktuellDokumentId }, { userId: nuri, admin: false }, opt())
    ).rejects.toMatchObject({ code: "UNGUELTIG" });
  });

  it("Push: zweiter paralleler Push 409 AKTUELL_GEAENDERT; neue Kalkulation 409 KALKULATION_NEU", async () => {
    await kvDokument("KV-KO-20261110-ART-3.pdf");
    const a = await dienst.ansicht(ws, deal, { userId: dario, admin: false }, opt());
    const s1 = a.staende[0];
    const e1 = await dienst.standAnlegen(ws, deal, { vorgaengerId: s1.id, setzen: [{ schluessel: "leistungen:transport:notiz", wert: "A" }], zuruecksetzen: [] }, dario, opt());
    await vpsFertig(vpsStarts[0]);
    const e2 = await dienst.standAnlegen(ws, deal, { vorgaengerId: e1.id, setzen: [{ schluessel: "leistungen:transport:notiz", wert: "B" }], zuruecksetzen: [] }, dario, opt());
    await vpsFertig(vpsStarts[1]);
    const r = await Promise.allSettled(
      [e1, e2].map((e) => dienst.pushen(ws, deal, e.id, { erwartetAktuellDokumentId: a.aktuellDokumentId }, { userId: dario, admin: false }, opt()))
    );
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const nein = r.find((x): x is PromiseRejectedResult => x.status === "rejected")!;
    expect(nein.reason).toMatchObject({ code: "AKTUELL_GEAENDERT", status: 409, daten: { gepushtVon: "Dario" } });

    const e3 = await dienst.standAnlegen(ws, deal, { vorgaengerId: (await staende()).at(-1)!.id, setzen: [{ schluessel: "leistungen:transport:notiz", wert: "C" }], zuruecksetzen: [] }, dario, opt());
    await vpsFertig(vpsStarts[2]);
    await versionSetzen(1);
    const aktuell = (await dienst.ansicht(ws, deal, { userId: dario, admin: false }, opt())).aktuellDokumentId;
    await expect(
      dienst.pushen(ws, deal, e3.id, { erwartetAktuellDokumentId: aktuell }, { userId: dario, admin: false }, opt())
    ).rejects.toMatchObject({ code: "KALKULATION_NEU", daten: { kalkulationVersion: 2 } });
  });

  it("Push mit aktiver Annahme: ohne Bestätigung 409, Member 403, Admin hebt in derselben Transaktion auf", async () => {
    const { angezeigtesKvDokument, neuestesKvDokument } = await import("@/lib/portal-dokumente");
    const alt = await kvDokument("KV-KO-20261110-ART-3.pdf", 30);
    const a = await dienst.ansicht(ws, deal, { userId: dario, admin: false }, opt());
    const e = await dienst.standAnlegen(ws, deal, { vorgaengerId: a.staende[0].id, setzen: [{ schluessel: "leistungen:transport:notiz", wert: "Neu" }], zuruecksetzen: [] }, dario, opt());
    await vpsFertig(vpsStarts[0]);
    const link = randomUUID();
    const annahme = randomUUID();
    await sql`insert into customer_status_links (id, workspace_id, deal_record_id, token) values (${link}, ${ws}, ${deal}, ${randomUUID()})`;
    await sql`insert into kva_confirmations (id, workspace_id, deal_record_id, customer_link_id, quotation_snapshot, confirmed_total_cents, agb_version_accepted, ip_address, user_agent, quotation_document_id)
      values (${annahme}, ${ws}, ${deal}, ${link}, '{}'::jsonb, 90000, 'agb-1', '127.0.0.1', 'test', ${alt})`;

    const ansichtJetzt = await dienst.ansicht(ws, deal, { userId: dario, admin: true }, opt());
    expect(ansichtJetzt.annahme).toMatchObject({ aktiv: true, standNummer: 1, aufhebenErlaubt: true });

    const push = (bestaetigt: boolean, admin: boolean) =>
      dienst.pushen(ws, deal, e.id, { erwartetAktuellDokumentId: alt, annahmeAufhebenBestaetigt: bestaetigt }, { userId: admin ? dario : nuri, admin }, opt());
    await expect(push(false, true)).rejects.toMatchObject({ code: "ANNAHME_AKTIV", status: 409, daten: { standNummer: 1 } });
    await expect(push(false, false)).rejects.toMatchObject({ code: "ANNAHME_AKTIV" });
    await expect(push(true, false)).rejects.toMatchObject({ code: "NUR_ADMIN", status: 403 });
    expect(await zaehlen()).toMatchObject({ dokumente: 1 });
    const [nochAktiv] = await sql`select superseded_at from kva_confirmations where id = ${annahme}`;
    expect(nochAktiv.superseded_at).toBeNull();
    expect(gemeldet).not.toHaveBeenCalled();

    const r = await push(true, true);
    expect(r.annahmeAufgehoben).toBe(true);
    const [z] = await sql`select superseded_at, superseded_by, superseded_reason from kva_confirmations where id = ${annahme}`;
    expect(z.superseded_at).not.toBeNull();
    expect(z).toMatchObject({ superseded_by: dario, superseded_reason: `KV geändert, Stand ${e.nummer}` });
    expect(gemeldet).toHaveBeenCalledTimes(1);
    // Das Portal zeigt danach das neue Dokument (Annahme nicht mehr aktiv, Grok 5).
    const reihen = await sql<{ id: string; uploadedAt: Date }[]>`select id, uploaded_at as "uploadedAt" from deal_documents where deal_record_id = ${deal}`;
    const aktiv = await sql`select 1 from kva_confirmations where deal_record_id = ${deal} and superseded_at is null`;
    const gezeigt = angezeigtesKvDokument({ quotationDocumentId: alt, angenommen: aktiv.length > 0, docRows: reihen, aktuellesKv: neuestesKvDokument(reihen) });
    expect(gezeigt?.id).toBe(r.dealDocumentId);
    const [doc] = await sql`select calculation_version_id, file_content from deal_documents where id = ${r.dealDocumentId}`;
    expect(doc).toMatchObject({ calculation_version_id: versionen[0], file_content: PDF.toString("base64") });
  });

  it("Push eines VPS-Stands mit Preisabweichung: STAND_NICHT_FERTIG", async () => {
    await kvDokument("KV-KO-20261110-ART-3.pdf");
    const a = await dienst.ansicht(ws, deal, { userId: dario, admin: false }, opt());
    const e = await dienst.standAnlegen(ws, deal, { vorgaengerId: a.staende[0].id, setzen: [{ schluessel: "leistungen:transport:notiz", wert: "X" }], zuruecksetzen: [] }, dario, opt());
    expect(await vpsFertig(vpsStarts[0], "abweichung")).toEqual({ art: "entwurf", status: "fehler" });
    await expect(
      dienst.pushen(ws, deal, e.id, { erwartetAktuellDokumentId: a.aktuellDokumentId }, { userId: dario, admin: false }, opt())
    ).rejects.toMatchObject({ code: "STAND_NICHT_FERTIG", daten: { status: "fehler" } });
    // Neu drucken: neuer Stand mit derselben Liste, eigener Druck (Kimi 21).
    const neu = await dienst.neuDrucken(ws, deal, e.id, dario, opt());
    expect(neu).toMatchObject({ nummer: 3, status: "druckt", vorgaengerId: e.id, quelle: "hand" });
    expect(neu.aenderungen.map((x) => [x.schluessel, x.wert])).toEqual([["leistungen:transport:notiz", "X"]]);
    expect(vpsStarts).toHaveLength(2);
  });

  // ─── Mitwandern ────────────────────────────────────────────────────────────

  it("Mitwandern über zwei Versionen (CRM, echter Haken): Liste wandert, Konflikt bleibt offen bis verworfen, Quelle nie ein Entwurf", async () => {
    const o = opt({ dealKopf: async () => ({ kunde: "Mira Beispiel", firma: "ceylan", firmaName: "Ceylan Umzüge" }) });
    const kv = () => docs.storeCommercialDocument({ workspaceId: ws, dealRecordId: deal, kind: "KV", updatedBy: dario });
    const doc1 = (await kv()).document.id;
    const s1 = (await staende())[0];
    expect(s1).toMatchObject({ quelle: "neu", deal_document_id: doc1, vorgaenger_id: null });

    const e = await dienst.standAnlegen(
      ws,
      deal,
      { vorgaengerId: s1.id, setzen: [{ schluessel: "bemerkungen:text:text", wert: "Bitte beim Hausmeister klingeln." }], zuruecksetzen: [] },
      dario,
      o
    );
    // Eine zweite Änderung, deren Basis sich inzwischen geändert hat (gemeinsamer Ausgangswert passt nicht mehr).
    const fremd: KvAenderung = { schluessel: "uebersicht:zusammenfassung:text", wert: "Umzug mit Klavier", vorher: "Alter Text", quelle: "hand", von: dario, am: new Date().toISOString() };
    await sql`update kv_staende set aenderungen = aenderungen || ${sql.json([fremd] as never)} where id = ${e.id}`;
    const p = await dienst.pushen(ws, deal, e.id, { erwartetAktuellDokumentId: doc1 }, { userId: dario, admin: false }, o);

    await versionSetzen(1);
    await kv();
    let s = await staende();
    const v2 = s.at(-1)!;
    expect(v2).toMatchObject({ quelle: "mitgewandert", vorgaenger_id: e.id, status: "fertig" });
    expect(v2.aenderungen.map((x) => [x.schluessel, x.wert])).toEqual([["bemerkungen:text:text", "Bitte beim Hausmeister klingeln."]]);
    expect(v2.offen).toEqual([expect.objectContaining({ art: "basis_geaendert", status: "offen", aenderung: expect.objectContaining({ schluessel: fremd.schluessel }) })]);
    expect(v2.deal_document_id).not.toBe(p.dealDocumentId);

    // Ein ungepushter Entwurf danach ist nie Quelle.
    await dienst.standAnlegen(
      ws,
      deal,
      { vorgaengerId: v2.id, setzen: [{ schluessel: "anschreiben:schluss:text", wert: "Bis bald." }], zuruecksetzen: [] },
      dario,
      o
    );
    await versionSetzen(2);
    await kv();
    s = await staende();
    const v3 = s.at(-1)!;
    expect(v3).toMatchObject({ quelle: "mitgewandert", vorgaenger_id: v2.id });
    expect(v3.aenderungen.map((x) => x.schluessel)).toEqual(["bemerkungen:text:text"]);
    expect(v3.offen).toEqual([expect.objectContaining({ art: "basis_geaendert", status: "offen" })]);
    const ansicht = await dienst.ansicht(ws, deal, { userId: dario, admin: false }, o);
    expect(ansicht).toMatchObject({ aktuellStandId: v3.id, offeneKonflikte: 1, kalkulationVersion: 3, hinweis: null });
    expect(await haken.kvEditorOffeneKonflikte(ws, deal)).toEqual({ offeneKonflikte: 1 });

    // Verwerfen gilt für den Deal: der nächste KV trägt den Konflikt nicht mehr.
    const k = await dienst.konflikteEntscheiden(ws, deal, { standId: v3.id, entscheidungen: [{ schluessel: fremd.schluessel, aktion: "verwerfen" }] }, dario, o);
    expect(k.neuerEntwurf).toBeNull();
    expect(k.stand.offen).toEqual([expect.objectContaining({ status: "verworfen", entschiedenVon: dario })]);
    expect(await haken.kvEditorOffeneKonflikte(ws, deal)).toEqual({ offeneKonflikte: 0 });
    await versionSetzen(3);
    await kv();
    const v4 = (await staende()).at(-1)!;
    expect(v4).toMatchObject({ quelle: "mitgewandert", vorgaenger_id: v3.id, offen: [] });
    expect(v4.aenderungen.map((x) => x.schluessel)).toEqual(["bemerkungen:text:text"]);
  });

  it("Konflikt übernehmen legt einen Entwurf mit dem neuen Wert an; Übertragen bei KALKULATION_NEU", async () => {
    const o = opt({ dealKopf: async () => ({ kunde: "Mira Beispiel", firma: "ceylan", firmaName: "Ceylan Umzüge" }) });
    const kv = () => docs.storeCommercialDocument({ workspaceId: ws, dealRecordId: deal, kind: "KV" });
    await kv();
    const s1 = (await staende())[0];
    const fremd: KvAenderung = { schluessel: "bemerkungen:text:text", wert: "Mit Aufzug", vorher: "gibt es nicht", quelle: "hand", von: dario, am: new Date().toISOString() };
    await sql`update kv_staende set offen = ${sql.json([{ aenderung: fremd, art: "basis_geaendert", basisJetzt: "", status: "offen" }] as never)} where id = ${s1.id}`;
    const r = await dienst.konflikteEntscheiden(ws, deal, { standId: s1.id, entscheidungen: [{ schluessel: fremd.schluessel, aktion: "uebernehmen" }] }, dario, o);
    expect(r.stand.offen[0]).toMatchObject({ status: "uebernommen" });
    expect(r.neuerEntwurf).toMatchObject({ quelle: "hand", status: "fertig", vorgaengerId: s1.id });
    expect(r.neuerEntwurf!.aenderungen).toEqual([expect.objectContaining({ schluessel: fremd.schluessel, wert: "Mit Aufzug" })]);
    expect(r.neuerEntwurf!.offen).toEqual([expect.objectContaining({ status: "uebernommen" })]);

    // Neue Kalkulation: Push des Entwurfs scheitert, „Auf den neuen KV übertragen“ legt einen Entwurf auf v2 an.
    await versionSetzen(1);
    await kv();
    const aktuell = (await dienst.ansicht(ws, deal, { userId: dario, admin: false }, o)).aktuellDokumentId;
    await expect(
      dienst.pushen(ws, deal, r.neuerEntwurf!.id, { erwartetAktuellDokumentId: aktuell }, { userId: dario, admin: false }, o)
    ).rejects.toMatchObject({ code: "KALKULATION_NEU" });
    const u = await dienst.uebertragen(ws, deal, r.neuerEntwurf!.id, dario, o);
    expect(u).toMatchObject({ kalkulationVersion: 2, status: "fertig", quelle: "hand" });
    expect(u.aenderungen.map((x) => [x.schluessel, x.wert])).toEqual([[fremd.schluessel, "Mit Aufzug"]]);
    const p = await dienst.pushen(ws, deal, u.id, { erwartetAktuellDokumentId: aktuell }, { userId: dario, admin: false }, o);
    expect(p.stand.aktuell).toBe(true);
  });

  // ─── KI-Herkunft ───────────────────────────────────────────────────────────

  it("KI-Herkunft prüft der Server: nur ein KI-Vorschlag des Deals, nur seine Werte, höchstens einmal (Kimi 17)", async () => {
    const o = opt({
      dealKopf: async () => ({ kunde: "Mira Beispiel", firma: "ceylan", firmaName: "Ceylan Umzüge" }),
      ki: {
        ki: async () => ({ antwort: "Ich ergänze den Hinweis.", aenderungen: [{ schluessel: "bemerkungen:text:text", wert: "Bitte vorher anrufen." }] }),
      },
    });
    await docs.storeCommercialDocument({ workspaceId: ws, dealRecordId: deal, kind: "KV" });
    const s1 = (await staende())[0];
    const antwort = await dienst.kvChat(ws, deal, { standId: s1.id, text: "Schreib rein, dass sie vorher anrufen sollen." }, dario, o);
    expect(antwort.vorschlaege).toEqual([expect.objectContaining({ schluessel: "bemerkungen:text:text", wert: "Bitte vorher anrufen." })]);
    const verlauf = await dienst.kvChatVerlauf(ws, deal);
    expect(verlauf.map((b) => [b.rolle, b.uebernommen])).toEqual([["nutzer", false], ["ki", false]]);

    const speichern = (setzen: { schluessel: string; wert: string }[], kiNachrichtId: string) =>
      dienst.standAnlegen(ws, deal, { vorgaengerId: s1.id, setzen, zuruecksetzen: [], kiNachrichtId }, nuri, o);
    // Falscher Wert, Nutzerbeitrag statt KI, fremde ID: abgelehnt.
    await expect(speichern([{ schluessel: "bemerkungen:text:text", wert: "Bitte vorher anrufen. Rabatt" }], antwort.nachrichtId)).rejects.toMatchObject({
      code: "UNGUELTIG",
      daten: { abgelehnt: [{ schluessel: "bemerkungen:text:text", grund: "NICHT_VORGESCHLAGEN" }] },
    });
    const nutzerId = verlauf[0].nachrichtId;
    await expect(speichern([{ schluessel: "bemerkungen:text:text", wert: "Bitte vorher anrufen." }], nutzerId)).rejects.toMatchObject({ code: "UNGUELTIG" });
    await expect(speichern([{ schluessel: "bemerkungen:text:text", wert: "Bitte vorher anrufen." }], randomUUID())).rejects.toMatchObject({ code: "UNGUELTIG" });

    const s2 = await speichern([{ schluessel: "bemerkungen:text:text", wert: "Bitte vorher anrufen." }], antwort.nachrichtId);
    expect(s2).toMatchObject({ quelle: "ki", erstelltVon: { id: nuri, name: "Nuri" } });
    expect(s2.aenderungen[0]).toMatchObject({ quelle: "ki", von: nuri });
    const [row] = await sql`select ki_nachricht_id from kv_staende where id = ${s2.id}`;
    expect(row.ki_nachricht_id).toBe(antwort.nachrichtId);
    expect((await dienst.kvChatVerlauf(ws, deal)).find((b) => b.nachrichtId === antwort.nachrichtId)?.uebernommen).toBe(true);
    // Höchstens einmal.
    await expect(
      dienst.standAnlegen(ws, deal, { vorgaengerId: s2.id, setzen: [{ schluessel: "bemerkungen:text:text", wert: "Bitte vorher anrufen." }], zuruecksetzen: [], kiNachrichtId: antwort.nachrichtId }, nuri, o)
    ).rejects.toMatchObject({ code: "UNGUELTIG", message: "Dieser Vorschlag wurde schon übernommen." });
  });

  // ─── Normaler KV-Weg ohne Editor ──────────────────────────────────────────

  it("normaler VPS-KV ohne Editor: Stand neu, Job abgelegt, Dokument aktuell; zweiter KV wie heute (der spätere gewinnt)", async () => {
    const erster = await vpsKvAusKalkulation();
    expect(await vpsFertig(erster)).toMatchObject({ art: "abgelegt" });
    let s = await staende();
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ quelle: "neu", status: "fertig", vorgaenger_id: null });
    expect(s[0].deal_document_id).not.toBeNull();

    const zweiter = await vpsKvAusKalkulation();
    expect(await vpsFertig(zweiter)).toMatchObject({ art: "abgelegt" });
    s = await staende();
    expect(s[1]).toMatchObject({ quelle: "neu", status: "fertig", vorgaenger_id: s[0].id });
    expect(await zaehlen()).toEqual({ dokumente: 2, staende: 2, jobs: 2 });
    const [akt] = await sql`select id from deal_documents where deal_record_id = ${deal} order by uploaded_at desc, id desc limit 1`;
    expect(s[1].deal_document_id).toBe(akt.id);
    // Neue Version zwischen Start und Ablage: verworfen wie heute.
    const dritter = await vpsKvAusKalkulation();
    await versionSetzen(1);
    expect(await vpsFertig(dritter)).toMatchObject({ art: "verworfen" });
    expect((await zaehlen()).dokumente).toBe(2);
  });

  it("normaler CRM-KV ohne Editor (echter Haken): Dokument und Stand je KV, ohne Änderungen", async () => {
    const r1 = await docs.storeCommercialDocument({ workspaceId: ws, dealRecordId: deal, kind: "KV" });
    const r2 = await docs.storeCommercialDocument({ workspaceId: ws, dealRecordId: deal, kind: "KV" });
    const s = await staende();
    expect(s.map((x) => [x.quelle, x.deal_document_id, x.aenderungen.length])).toEqual([
      ["neu", r1.document.id, 0],
      ["neu", r2.document.id, 0],
    ]);
    expect(s[1].vorgaenger_id).toBe(s[0].id);
    expect(await zaehlen()).toEqual({ dokumente: 2, staende: 2, jobs: 0 });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { RENDER_JOB_ABLAUF_MS, RENDER_JOB_RESERVIERUNG_MS } from "@/lib/angebot-wahl";

const aufgezeichnet: { sql: string; params: unknown[] }[] = [];
const sqlToQuery = PgDialect.prototype.sqlToQuery;

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const client = {
    options: { parsers: {} as Record<string, unknown>, serializers: {} as Record<string, unknown> },
    unsafe() {
      const ergebnis = Promise.resolve([]) as unknown as Promise<unknown[]> & { values: () => Promise<unknown[][]> };
      ergebnis.values = () => Promise.resolve([]);
      return ergebnis;
    },
  };
  return { db: drizzle(client as never) };
});

import {
  jobAbschliessen,
  jobAnlegen,
  jobLaden,
  jobReservieren,
  jobsAbgelaufenMarkieren,
  letzterKvJob,
  offeneJobs,
} from "./render-jobs";

function norm(sql: string) {
  return sql.replace(/\s+/g, " ").trim();
}

/** Volle Anweisungen. Der Dialekt kompiliert zwischendurch auch Fragmente. */
function anweisungen() {
  return aufgezeichnet.filter((q) => /^(select|insert|update|delete|with)\b/i.test(q.sql.trim()));
}

beforeEach(() => {
  aufgezeichnet.length = 0;
  vi.spyOn(PgDialect.prototype, "sqlToQuery").mockImplementation(function (this: PgDialect, query: SQL) {
    const kompiliert = sqlToQuery.call(this, query);
    aufgezeichnet.push({ sql: kompiliert.sql, params: kompiliert.params });
    return kompiliert;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const ws = "ws-1";
const id = "job-1";
const jetzt = new Date("2026-11-07T10:00:00.000Z");
const neuerJob = {
  vpsJobId: id,
  workspaceId: ws,
  dealRecordId: "deal-1",
  documentType: "quotation",
  calculationVersionId: "ver-1",
  priceCents: 19900,
  createdBy: "user-1",
};

function enthaeltZeit(params: unknown[], zeit: Date) {
  return params.some((p) => {
    if (p instanceof Date) return p.getTime() === zeit.getTime();
    if (typeof p === "string") return new Date(p).getTime() === zeit.getTime();
    return false;
  });
}

describe("render-jobs SQL", () => {
  it("jede Abfrage außer den beiden Cron-Läufen enthält workspace_id", async () => {
    const cron = new Set(["offeneJobs", "jobsAbgelaufenMarkieren"]);
    const faelle: [string, () => Promise<unknown>][] = [
      ["jobAnlegen", () => jobAnlegen(neuerJob)],
      ["jobLaden", () => jobLaden(ws, id)],
      ["jobReservieren", () => jobReservieren(ws, id, jetzt)],
      ["jobAbschliessen", () => jobAbschliessen(ws, id, { status: "verworfen" })],
      ["letzterKvJob", () => letzterKvJob(ws, "deal-1", "ver-1")],
      ["offeneJobs", () => offeneJobs(jetzt, 10)],
      ["jobsAbgelaufenMarkieren", () => jobsAbgelaufenMarkieren(jetzt)],
    ];

    for (const [name, fn] of faelle) {
      aufgezeichnet.length = 0;
      await fn();
      const queries = anweisungen();
      expect(queries.length, name).toBeGreaterThan(0);
      for (const q of queries) {
        if (cron.has(name)) expect(norm(q.sql), name).not.toMatch(/"workspace_id"\s*=/);
        else expect(q.sql, name).toContain("workspace_id");
      }
    }
  });

  it("legt mit ON CONFLICT (vps_job_id) DO NOTHING an", async () => {
    await jobAnlegen(neuerJob);
    const [q] = anweisungen();
    expect(norm(q.sql)).toMatch(/^insert into "document_render_jobs"/);
    expect(norm(q.sql)).toContain('on conflict ("vps_job_id") do nothing');
    expect(q.params).toContain(ws);
  });

  it("reserviert in einer Anweisung mit Workspace, Status und abgelaufener Reservierung", async () => {
    await jobReservieren(ws, id, jetzt);
    const queries = anweisungen();
    expect(queries).toHaveLength(1);
    const q = norm(queries[0].sql);
    expect(q).toMatch(/^update "document_render_jobs" set "claimed_at"/);
    expect(q).toContain('"workspace_id" =');
    expect(q).toContain('"vps_job_id" =');
    expect(q).toContain('"status" =');
    expect(q).toContain('"claimed_at" is null');
    expect(q).toContain('"claimed_at" <');
    expect(q).toContain("returning");
    expect(q).not.toContain(";");
    expect(queries[0].params).toEqual(expect.arrayContaining([ws, id, "laeuft"]));
    expect(enthaeltZeit(queries[0].params, jetzt)).toBe(true);
    expect(enthaeltZeit(queries[0].params, new Date(jetzt.getTime() - RENDER_JOB_RESERVIERUNG_MS))).toBe(true);
  });

  it("setzt stored_at nur beim Ablegen auf now()", async () => {
    await jobAbschliessen(ws, id, { status: "abgelegt", dealDocumentId: "doc-1" });
    const abgelegt = norm(anweisungen()[0].sql);
    expect(abgelegt).toContain('"stored_at" = now()');
    expect(abgelegt).toContain('"workspace_id" =');
    expect(abgelegt).toContain('"status" =');

    aufgezeichnet.length = 0;
    await jobAbschliessen(ws, id, { status: "fehler", fehler: "vps" });
    const fehler = norm(anweisungen()[0].sql);
    expect(fehler).not.toContain("stored_at");
    expect(fehler).toContain('"workspace_id" =');
    expect(anweisungen()[0].params).toEqual(expect.arrayContaining(["fehler", "vps", ws, id]));
  });

  it("liest offene Jobs ohne Workspace, älteste zuerst", async () => {
    await offeneJobs(jetzt, 10);
    const q = norm(anweisungen()[0].sql);
    expect(q).toMatch(/^select /);
    expect(q).toContain('"status" =');
    expect(q).toContain('"claimed_at" is null');
    expect(q).toContain('"claimed_at" <');
    expect(q).toMatch(/"created_at" asc/);
    expect(q).toContain("limit");
    expect(q).not.toMatch(/"workspace_id"\s*=/);
    expect(anweisungen()[0].params).toContain("laeuft");
  });

  it("nimmt den neuesten KV-Job der Version im Workspace", async () => {
    await letzterKvJob(ws, "deal-1", "ver-1");
    const q = norm(anweisungen()[0].sql);
    expect(q).toContain('"workspace_id" =');
    expect(q).toContain('"deal_record_id" =');
    expect(q).toContain('"calculation_version_id" =');
    expect(q).toContain('"document_type" =');
    expect(q).toMatch(/"created_at" desc/);
    expect(anweisungen()[0].params).toEqual(expect.arrayContaining([ws, "deal-1", "ver-1", "quotation"]));
  });

  it("markiert abgelaufene Jobs ohne Workspace-Filter", async () => {
    await jobsAbgelaufenMarkieren(jetzt);
    const queries = anweisungen();
    expect(queries).toHaveLength(1);
    const q = norm(queries[0].sql);
    expect(q).toMatch(/^update "document_render_jobs" set "status"/);
    expect(q).toContain('"created_at" <');
    expect(q).not.toMatch(/"workspace_id"/);
    expect(queries[0].params).toEqual(expect.arrayContaining(["fehler", "abgelaufen", "laeuft"]));
    expect(enthaeltZeit(queries[0].params, new Date(jetzt.getTime() - RENDER_JOB_ABLAUF_MS))).toBe(true);
    expect(await jobsAbgelaufenMarkieren(jetzt)).toBe(0);
  });
});

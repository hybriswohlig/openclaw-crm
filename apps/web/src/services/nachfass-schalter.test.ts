import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  releaseHumanOwnership: vi.fn(),
  getDealStageCategory: vi.fn(),
  supersedePendingDrafts: vi.fn(),
  isSalesAgentDryRun: vi.fn(),
  isEngineDryRun: vi.fn(),
}));

// Nur `db.execute` ist erlaubt (dbSpeicher); jeder andere Zugriff lässt den Test scheitern.
vi.mock("@/db", () => ({
  db: new Proxy(
    {},
    {
      get(_t, p) {
        if (p === "execute") return mocks.execute;
        if (p === "then" || typeof p === "symbol") return undefined;
        throw new Error(`@/db im Test (${String(p)})`);
      },
    }
  ),
}));
vi.mock("@/services/agent/agent-gate", () => ({
  releaseHumanOwnership: mocks.releaseHumanOwnership,
  getDealStageCategory: mocks.getDealStageCategory,
}));
vi.mock("@/services/agent/draft-schliessen", () => ({
  supersedePendingDrafts: mocks.supersedePendingDrafts,
}));
vi.mock("@/services/agent/agent-config", () => ({
  isSalesAgentDryRun: mocks.isSalesAgentDryRun,
  isEngineDryRun: mocks.isEngineDryRun,
}));

import {
  dbSpeicher,
  NachfassSchalterFehler,
  ladeNachfassSchalter,
  setzeNachfassSchalter,
  type NachfassSchalterSpeicher,
  type RegelSchalterZeile,
} from "./nachfass-schalter";

const WS = "ws_1";
const DEAL = "deal_1";

/** In-Memory-Abbild der Tabellen, die der Schalter liest und schreibt. */
function fake(start: {
  stopReason?: string | null;
  zeileDa?: boolean;
  humanOwned?: boolean;
  gespraeche?: { id: string; dealRecordId: string | null; aiPaused: boolean }[];
  schalter?: RegelSchalterZeile[];
  fu1SentAt?: Date | null;
  angebotAm?: Date | null;
  fremdeFirma?: boolean;
}) {
  const st = {
    zeileDa: start.zeileDa ?? start.stopReason !== undefined,
    stopReason: start.stopReason ?? null,
    humanOwned: start.humanOwned ?? false,
    gespraeche: start.gespraeche ?? [],
  };
  const speicher: NachfassSchalterSpeicher = {
    lesen: vi.fn(async () => ({
      stopReason: st.zeileDa ? st.stopReason : null,
      gesendet: { fu1SentAt: start.fu1SentAt ?? null, fu2SentAt: null, closeSentAt: null },
      humanOwned: st.humanOwned,
      aiPaused: st.gespraeche.some((g) => g.dealRecordId === DEAL && g.aiPaused),
      ocId: "oc_1",
      fremdeFirma: start.fremdeFirma ?? false,
      angebotAm: start.angebotAm ?? null,
    })),
    regelSchalter: vi.fn(async () => start.schalter ?? []),
    // wie das SQL: neue Zeile mit inhaber_aus, bestehende nur bei stop_reason IS NULL
    stopSetzenWennLeer: vi.fn(async () => {
      if (!st.zeileDa) { st.zeileDa = true; st.stopReason = "inhaber_aus"; return; }
      if (st.stopReason === null) st.stopReason = "inhaber_aus";
    }),
    // wie das SQL: Zeile anlegen, stop_reason nur in {inhaber_aus, human_owned, ai_paused} löschen
    schalterStopLoeschen: vi.fn(async () => {
      if (!st.zeileDa) { st.zeileDa = true; st.stopReason = null; return; }
      if (["inhaber_aus", "human_owned", "ai_paused"].includes(st.stopReason ?? "")) st.stopReason = null;
    }),
    gespraecheFortsetzen: vi.fn(async (_ws: string, deal: string) => {
      for (const g of st.gespraeche) if (g.dealRecordId === deal) g.aiPaused = false;
    }),
  };
  mocks.releaseHumanOwnership.mockImplementation(async () => { st.humanOwned = false; });
  return { st, speicher };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDealStageCategory.mockResolvedValue({ statusId: "s", title: "Angebot", category: "quoted", isTerminal: false });
  mocks.isSalesAgentDryRun.mockResolvedValue(false);
  mocks.isEngineDryRun.mockResolvedValue(false);
  mocks.supersedePendingDrafts.mockResolvedValue(0);
});

describe("ladeNachfassSchalter", () => {
  const voll = (regel: string, oc = "oc_1"): RegelSchalterZeile => ({ oc, regel, an: true, sauber: 20 });

  it("frei, kein Dry-Run, Regel a1 auto_send mit 20 sauberen Freigaben → sendet", async () => {
    const { speicher } = fake({ schalter: [voll("a1")] });
    const s = await ladeNachfassSchalter(WS, DEAL, speicher);
    expect(s).toMatchObject({ an: true, modus: "sendet", text: "automatisch, sendet" });
    expect(s.regeln.map((r) => r.art)).toEqual(["auto", "entwurf", "entwurf"]);
    expect(mocks.getDealStageCategory).toHaveBeenCalledWith(WS, DEAL);
    expect(mocks.isEngineDryRun).toHaveBeenCalledWith(WS, "followup");
  });

  it("Dry-Run (geteilt oder followup) → entwurf", async () => {
    const { speicher } = fake({ schalter: [voll("a1")] });
    mocks.isSalesAgentDryRun.mockResolvedValue(true);
    expect((await ladeNachfassSchalter(WS, DEAL, speicher)).modus).toBe("entwurf");
    mocks.isSalesAgentDryRun.mockResolvedValue(false);
    mocks.isEngineDryRun.mockResolvedValue(true);
    expect((await ladeNachfassSchalter(WS, DEAL, speicher)).modus).toBe("entwurf");
  });

  it("auto_send über die Workspace-Zeile (''), Freigaben zählen wie im Motor nur an der Zeile der Firma", async () => {
    const { speicher } = fake({ schalter: [{ oc: "", regel: "a1", an: true, sauber: 50 }] });
    expect((await ladeNachfassSchalter(WS, DEAL, speicher)).modus).toBe("entwurf");
    const zwei = fake({ schalter: [{ oc: "", regel: "a1", an: true, sauber: 0 }, { oc: "oc_1", regel: "a1", an: true, sauber: 20 }] });
    expect((await ladeNachfassSchalter(WS, DEAL, zwei.speicher)).modus).toBe("sendet");
  });

  it("19 saubere Freigaben → entwurf", async () => {
    const { speicher } = fake({ schalter: [{ oc: "oc_1", regel: "a1", an: true, sauber: 19 }] });
    expect((await ladeNachfassSchalter(WS, DEAL, speicher)).modus).toBe("entwurf");
  });

  it("nächste Regel nach FU1 ist a2", async () => {
    const { speicher } = fake({ schalter: [voll("a1")], fu1SentAt: new Date("2026-11-04T10:00:00Z") });
    expect((await ladeNachfassSchalter(WS, DEAL, speicher)).modus).toBe("entwurf");
  });

  it("Stufe lost → beendet", async () => {
    const { speicher } = fake({});
    mocks.getDealStageCategory.mockResolvedValue({ statusId: "s", title: "Verloren", category: "lost", isTerminal: true });
    expect((await ladeNachfassSchalter(WS, DEAL, speicher)).modus).toBe("beendet");
  });

  it.each(["booked", "paid", "done_unpaid"])("Stufe %s → beendet (Motor-Filter)", async (category) => {
    const { speicher } = fake({ schalter: [voll("a1")] });
    mocks.getDealStageCategory.mockResolvedValue({ statusId: "s", title: "x", category, isTerminal: true });
    expect((await ladeNachfassSchalter(WS, DEAL, speicher)).modus).toBe("beendet");
  });

  it("Deal ohne Stufe → beendet", async () => {
    const { speicher } = fake({});
    mocks.getDealStageCategory.mockResolvedValue({ statusId: null, title: null, category: null, isTerminal: false });
    expect((await ladeNachfassSchalter(WS, DEAL, speicher)).modus).toBe("beendet");
  });

  it("fremde Firma → beendet", async () => {
    const { speicher } = fake({ fremdeFirma: true, schalter: [voll("a1")] });
    expect((await ladeNachfassSchalter(WS, DEAL, speicher))).toMatchObject({ an: false, modus: "beendet" });
  });

  it("geplantAm = Angebotsdatum + 2/7/10 Tage", async () => {
    const { speicher } = fake({ angebotAm: new Date("2026-11-02T09:00:00.000Z") });
    const s = await ladeNachfassSchalter(WS, DEAL, speicher);
    expect(s.regeln.map((r) => r.geplantAm)).toEqual([
      "2026-11-04T09:00:00.000Z",
      "2026-11-09T09:00:00.000Z",
      "2026-11-12T09:00:00.000Z",
    ]);
  });
});

describe("setzeNachfassSchalter", () => {
  describe.each([
    ["optout", { stopReason: "optout" as string | null, category: "quoted", fremdeFirma: false }],
    ["kunde_hat_geantwortet", { stopReason: "kunde_hat_geantwortet", category: "quoted", fremdeFirma: false }],
    ["Stufe lost", { stopReason: null, category: "lost", fremdeFirma: false }],
    ["Stufe booked", { stopReason: "inhaber_aus", category: "booked", fremdeFirma: false }],
    ["fremde Firma", { stopReason: null, category: "quoted", fremdeFirma: true }],
  ])("beendet (%s): Ein- und Ausschalten schreiben nichts", (_name, lage) => {
    it.each([true, false])("an = %s → NachfassSchalterFehler BEENDET, keine Schreibfunktion", async (an) => {
      const { st, speicher } = fake({
        stopReason: lage.stopReason,
        zeileDa: true,
        humanOwned: true,
        fremdeFirma: lage.fremdeFirma,
        gespraeche: [{ id: "c1", dealRecordId: DEAL, aiPaused: true }],
      });
      mocks.getDealStageCategory.mockResolvedValue({ statusId: "s", title: "x", category: lage.category, isTerminal: false });
      const fehler = await setzeNachfassSchalter(WS, DEAL, an, "usr_1", speicher).catch((e: unknown) => e);
      expect(fehler).toBeInstanceOf(NachfassSchalterFehler);
      expect(fehler).toMatchObject({ code: "BEENDET", message: "Die Nachfass-Sequenz ist für diesen Deal beendet." });
      expect(speicher.stopSetzenWennLeer).not.toHaveBeenCalled();
      expect(speicher.schalterStopLoeschen).not.toHaveBeenCalled();
      expect(speicher.gespraecheFortsetzen).not.toHaveBeenCalled();
      expect(mocks.releaseHumanOwnership).not.toHaveBeenCalled();
      expect(mocks.supersedePendingDrafts).not.toHaveBeenCalled();
      expect(st).toMatchObject({ stopReason: lage.stopReason, humanOwned: true });
      expect(st.gespraeche[0].aiPaused).toBe(true);
    });
  });

  it("Ausschalten bei NULL setzt inhaber_aus und ruft supersedePendingDrafts", async () => {
    const { st, speicher } = fake({ stopReason: null });
    const s = await setzeNachfassSchalter(WS, DEAL, false, "usr_1", speicher);
    expect(st.stopReason).toBe("inhaber_aus");
    expect(speicher.stopSetzenWennLeer).toHaveBeenCalledWith(WS, DEAL);
    expect(mocks.supersedePendingDrafts).toHaveBeenCalledWith({
      workspaceId: WS,
      dealRecordId: DEAL,
      userId: "usr_1",
      supersededBy: "inhaber_aus",
    });
    expect(s).toMatchObject({ an: false, modus: "aus", text: "aus" });
    expect(mocks.releaseHumanOwnership).not.toHaveBeenCalled();
  });

  it("Ausschalten ohne Zeile legt sie mit inhaber_aus an", async () => {
    const { st, speicher } = fake({});
    await setzeNachfassSchalter(WS, DEAL, false, "usr_1", speicher);
    expect(st).toMatchObject({ zeileDa: true, stopReason: "inhaber_aus" });
  });

  it("Einschalten bei human_owned: releaseHumanOwnership, ai_paused nur an Gesprächen des Deals, stop_reason gelöscht", async () => {
    const { st, speicher } = fake({
      stopReason: "human_owned",
      humanOwned: true,
      gespraeche: [
        { id: "c1", dealRecordId: DEAL, aiPaused: true },
        { id: "c2", dealRecordId: "deal_anders", aiPaused: true },
        { id: "c3", dealRecordId: null, aiPaused: true },
      ],
    });
    const s = await setzeNachfassSchalter(WS, DEAL, true, "usr_1", speicher);
    expect(mocks.releaseHumanOwnership).toHaveBeenCalledWith(WS, DEAL);
    expect(speicher.gespraecheFortsetzen).toHaveBeenCalledWith(WS, DEAL);
    expect(st.gespraeche.map((g) => g.aiPaused)).toEqual([false, true, true]);
    expect(st.stopReason).toBeNull();
    expect(s).toMatchObject({ an: true, modus: "entwurf" });
    expect(mocks.supersedePendingDrafts).not.toHaveBeenCalled();
  });

  it("Einschalten nach inhaber_aus löscht stop_reason, ohne Zeile wird sie angelegt", async () => {
    const a = fake({ stopReason: "inhaber_aus" });
    await setzeNachfassSchalter(WS, DEAL, true, "usr_1", a.speicher);
    expect(a.st.stopReason).toBeNull();
    const b = fake({});
    await setzeNachfassSchalter(WS, DEAL, true, "usr_1", b.speicher);
    expect(b.st).toMatchObject({ zeileDa: true, stopReason: null });
  });
});

describe("dbSpeicher: SQL", () => {
  const dialekt = new PgDialect();
  const gerendert = (i: number) => {
    const q = dialekt.sqlToQuery(mocks.execute.mock.calls[i][0] as SQL);
    return { text: q.sql.replace(/\s+/g, " ").trim(), params: q.params };
  };

  beforeEach(() => mocks.execute.mockResolvedValue([]));

  it("stopSetzenWennLeer: Zeile anlegen mit inhaber_aus, bestehende nur bei stop_reason IS NULL", async () => {
    await dbSpeicher.stopSetzenWennLeer(WS, DEAL);
    const { text, params } = gerendert(0);
    expect(text).toMatch(/^insert into nachfass_deal_state \(deal_record_id, workspace_id, stop_reason\)/i);
    expect(text).toMatch(/on conflict \(deal_record_id\) do update set stop_reason = 'inhaber_aus'/i);
    expect(text).toMatch(/where nachfass_deal_state\.stop_reason is null and nachfass_deal_state\.workspace_id = \$\d/i);
    expect(params).toEqual([DEAL, WS, WS]);
  });

  it("schalterStopLoeschen: Zeile anlegen, stop_reason nur in {inhaber_aus, human_owned, ai_paused} löschen", async () => {
    await dbSpeicher.schalterStopLoeschen(WS, DEAL);
    const { text, params } = gerendert(0);
    expect(text).toMatch(/^insert into nachfass_deal_state \(deal_record_id, workspace_id\)/i);
    expect(text).toMatch(/do update set stop_reason = null/i);
    expect(text).toMatch(/where nachfass_deal_state\.stop_reason in \('inhaber_aus', 'human_owned', 'ai_paused'\) and nachfass_deal_state\.workspace_id = \$\d/i);
    expect(params).toEqual([DEAL, WS, WS]);
  });

  it("gespraecheFortsetzen: ai_paused = false nur an Gesprächen mit deal_record_id = deal im Workspace", async () => {
    await dbSpeicher.gespraecheFortsetzen(WS, DEAL);
    const { text, params } = gerendert(0);
    expect(text).toMatch(/^update inbox_conversations set ai_paused = false/i);
    expect(text).toMatch(/where workspace_id = \$1 and deal_record_id = \$2 and ai_paused = true$/i);
    expect(params).toEqual([WS, DEAL]);
  });

  it("lesen: liest Zeilen nur des Deals im Workspace und setzt Datumswerte um", async () => {
    mocks.execute.mockResolvedValue([
      {
        stop_reason: "inhaber_aus",
        // so liefert db.execute eine timestamp-Spalte: Text ohne Zone, gespeichert UTC
        fu1_sent_at: "2026-11-04 10:00:00.123456",
        fu2_sent_at: null,
        close_sent_at: null,
        human_owned: true,
        ai_paused: false,
        oc: null,
        state_oc: "oc_9",
        kv_sent_at: null,
        kv_doc_at: new Date("2026-11-02T09:00:00.000Z"),
        fremde_firma: true,
      },
    ]);
    const roh = await dbSpeicher.lesen(WS, DEAL);
    expect(roh).toEqual({
      stopReason: "inhaber_aus",
      gesendet: { fu1SentAt: new Date("2026-11-04T10:00:00.123Z"), fu2SentAt: null, closeSentAt: null },
      humanOwned: true,
      aiPaused: false,
      ocId: "oc_9",
      fremdeFirma: true,
      angebotAm: new Date("2026-11-02T09:00:00.000Z"),
    });
    const { text, params } = gerendert(0);
    expect(text).toMatch(/c\.workspace_id = \$\d+ and c\.deal_record_id = \$\d+ and c\.ai_paused/i);
    expect(text).toMatch(/document_type = 'quotation'/i);
    // Firmen-Filter wie motor.ts (laufFuerWorkspace): benannte Firma, weder Kottke noch Ceylan
    expect(text).toMatch(/inner join records oc on oc\.id = ocv\.referenced_record_id and oc\.deleted_at is null/i);
    expect(text).toMatch(/coalesce\(ocn\.text_value, ''\) <> '' and ocn\.text_value not ilike '%kottke%' and ocn\.text_value not ilike '%ceylan%'/i);
    expect(params.every((p) => p === WS || p === DEAL)).toBe(true);
  });

  it("lesen: KV-Version sent_at geht vor dem Dokument, ohne Zeile alles leer", async () => {
    mocks.execute.mockResolvedValue([
      { stop_reason: null, fu1_sent_at: null, fu2_sent_at: null, close_sent_at: null, human_owned: null, ai_paused: false, oc: "oc_1", state_oc: null, kv_sent_at: "2026-11-03T08:00:00.000Z", kv_doc_at: "2026-11-02T09:00:00.000Z" },
    ]);
    const roh = await dbSpeicher.lesen(WS, DEAL);
    expect(roh.angebotAm).toEqual(new Date("2026-11-03T08:00:00.000Z"));
    expect(roh.ocId).toBe("oc_1");
    expect(roh.humanOwned).toBe(false);
    expect(roh.fremdeFirma).toBe(false);
  });

  it("regelSchalter: nur der Workspace", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ oc: "", regel: "a1", an: true, sauber: 3 }] });
    expect(await dbSpeicher.regelSchalter(WS)).toEqual([{ oc: "", regel: "a1", an: true, sauber: 3 }]);
    const { text, params } = gerendert(0);
    expect(text).toMatch(/from nachfass_rule_switches where workspace_id = \$1$/i);
    expect(params).toEqual([WS]);
  });
});

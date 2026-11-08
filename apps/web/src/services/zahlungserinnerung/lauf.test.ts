import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import {
  euro,
  erinnerungBetreff,
  erinnerungKanal,
  erinnerungSchluessel,
  erinnerungText,
  type ErinnerungEingabe,
  type ErinnerungGrund,
  type ErinnerungKandidat,
  type ErinnerungStand,
} from "@/lib/geld";
import { CEYLAN_WA_PRAEFIX, istCeylanWhatsApp } from "@/services/nachfass/konstanten";

const JETZT = new Date("2026-11-10T09:00:00Z");

const state = vi.hoisted(() => ({
  workspaces: [{ id: "ws1" }] as { id: string }[],
  syncRows: [] as Record<string, unknown>[],
  stopRows: [] as Record<string, unknown>[],
  reminderRows: [] as Record<string, unknown>[],
  drafts: [] as Record<string, unknown>[],
  payments: [] as { dealRecordId: string; amount: string; taxTreatment: string }[],
  events: [] as { id: string; recordId: string; eventType: string; payload: unknown; createdAt: Date }[],
  channelAccountId: null as string | null,
  sentCount: null as number | null,
  inserted: [] as { id: string; invoiceId: string; stufe: number; status: string; draftId: string }[],
  kandidaten: [] as ErinnerungKandidat[],
}));

type EntwurfErgebnis =
  | { ok: true; created: true; draft: { id: string } }
  | { ok: false; status: number; error: string; message: string; existingDraftId?: string };

const bounds = vi.hoisted(() => ({
  lade: vi.fn(async (_ws: string, _jetzt: Date): Promise<ErinnerungKandidat[]> => state.kandidaten),
  create: vi.fn(async (_input: unknown): Promise<EntwurfErgebnis> => ({
    ok: true,
    created: true,
    draft: { id: "d-new" },
  })),
}));

vi.mock("./auswahl", () => ({
  ladeKandidaten: (ws: string, jetzt: Date) => bounds.lade(ws, jetzt),
}));

vi.mock("@/services/agent/agent-drafts", () => ({
  createAgentDraft: (input: unknown) => bounds.create(input),
}));

vi.mock("@/db", () => {
  function nameOf(table: unknown): string {
    try {
      return getTableName(table as Parameters<typeof getTableName>[0]);
    } catch {
      return "";
    }
  }
  function rowsFor(name: string): unknown[] {
    switch (name) {
      case "workspaces":
        return state.workspaces;
      case "agent_drafts":
        return state.syncRows;
      case "payment_reminders":
        return state.stopRows;
      case "payments":
        return state.payments;
      case "activity_events":
        return state.events;
      case "inbox_conversations":
        return state.channelAccountId ? [{ channelAccountId: state.channelAccountId }] : [];
      case "nachfass_daily_sends":
        return state.sentCount == null ? [] : [{ sentCount: state.sentCount }];
      default:
        return [];
    }
  }
  return {
    db: {
      select: () => {
        let rows: unknown[] = [];
        const chain: Record<string, unknown> = {
          from(table: unknown) {
            rows = rowsFor(nameOf(table));
            return chain;
          },
          innerJoin: () => chain,
          leftJoin: () => chain,
          where: () => chain,
          limit: () => chain,
          orderBy: () => chain,
          then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(rows).then(ok, bad),
        };
        return chain;
      },
      update: (table: unknown) => {
        let patch: Record<string, unknown> = {};
        let applied = false;
        const apply = () => {
          if (applied) return [];
          applied = true;
          const name = nameOf(table);
          if (name === "payment_reminders") {
            for (const row of state.reminderRows) Object.assign(row, patch);
          }
          if (name === "agent_drafts") {
            for (const row of state.drafts) {
              if (row.status === "pending") Object.assign(row, patch);
            }
          }
          return [];
        };
        const chain: Record<string, unknown> = {
          set(v: Record<string, unknown>) {
            patch = v;
            return chain;
          },
          where: () => chain,
          then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(apply()).then(ok, bad),
        };
        return chain;
      },
      insert: (table: unknown) => {
        let vals: Record<string, unknown> = {};
        let ran = false;
        let result: { id: string }[] = [];
        const run = () => {
          if (ran) return result;
          ran = true;
          if (nameOf(table) !== "payment_reminders") return result;
          const invoiceId = String(vals.invoiceId);
          const stufe = Number(vals.stufe);
          if (state.inserted.some((r) => r.invoiceId === invoiceId && r.stufe === stufe)) return result;
          const id = `rem-${state.inserted.length + 1}`;
          state.inserted.push({
            id,
            invoiceId,
            stufe,
            status: String(vals.status ?? "entwurf"),
            draftId: String(vals.draftId ?? ""),
          });
          result = [{ id }];
          return result;
        };
        const chain: Record<string, unknown> = {
          values(v: Record<string, unknown>) {
            vals = v;
            return chain;
          },
          onConflictDoNothing: () => chain,
          returning: () => Promise.resolve(run()),
          then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
        };
        return chain;
      },
    },
  };
});

import { runZahlungserinnerung } from "./lauf";

const TEXT = {
  anrede: "du" as const,
  name: "Anna",
  nummer: "RE-2026-0001",
  rechnungstag: "2026-10-31",
  betragCent: 50000,
  faelligAm: "2026-10-31",
  portalLink: "https://openclaw-crm-web.vercel.app/s/abc",
  signatur: "Kottke Umzüge",
};

function due(): ErinnerungEingabe {
  return {
    regel: { basis: "umzugstag", tage: 0, erinnerungModus: "entwurf", erinnerungTage: 7, erinnerung2Tage: 14 },
    heute: "2026-11-10",
    rechnung: { status: "gestellt", bruttoCent: 50000, faelligAm: "2026-10-31" },
    restCent: 50000,
    bisher: [],
    offeneMeldung: false,
    letzteKundennachrichtAm: null,
    sperre: null,
    bewertungGesperrt: false,
    verloren: false,
    kanal: "email",
  };
}

function kandidat(patch: Partial<ErinnerungEingabe>, invoiceId = "inv-1"): ErinnerungKandidat {
  const eingabe = { ...due(), ...patch };
  return {
    workspaceId: "ws1",
    dealRecordId: "deal-1",
    invoiceId,
    operatingCompanyId: "oc-1",
    firma: "kottke",
    eingabe,
    text: TEXT,
    conversationId: eingabe.kanal ? "conv-1" : null,
  };
}

function reset() {
  state.workspaces = [{ id: "ws1" }];
  state.syncRows = [];
  state.stopRows = [];
  state.reminderRows = [];
  state.drafts = [];
  state.payments = [];
  state.events = [];
  state.channelAccountId = null;
  state.sentCount = null;
  state.inserted = [];
  state.kandidaten = [];
}

beforeEach(() => {
  reset();
  bounds.lade.mockReset();
  bounds.lade.mockImplementation(async () => state.kandidaten);
  bounds.create.mockReset();
  bounds.create.mockImplementation(async () => ({ ok: true as const, created: true, draft: { id: "d-new" } }));
});

describe("runZahlungserinnerung", () => {
  it("außerhalb des Kundenfensters passiert nichts", async () => {
    state.kandidaten = [kandidat({})];
    const winter = await runZahlungserinnerung(new Date("2026-11-10T07:00:00Z"));
    const sommer = await runZahlungserinnerung(new Date("2026-07-07T06:30:00Z"));
    for (const summary of [winter, sommer]) {
      expect(summary).toEqual({
        workspaces: 0,
        geprueft: 0,
        entwuerfe: 0,
        gestoppt: 0,
        ohneKanal: 0,
        fehler: 0,
        gruende: {},
      });
    }
    expect(bounds.lade).not.toHaveBeenCalled();
    expect(bounds.create).not.toHaveBeenCalled();
  });

  it("Sommerzeit 09:30 läuft, 08:30 nicht", async () => {
    const draussen = await runZahlungserinnerung(new Date("2026-07-07T06:30:00Z"));
    expect(draussen.workspaces).toBe(0);
    const drinnen = await runZahlungserinnerung(new Date("2026-07-07T07:30:00Z"));
    expect(drinnen.workspaces).toBe(1);
    expect(bounds.lade).toHaveBeenCalledTimes(1);
  });

  it("zählt jeden Stoppgrund und legt bei Modus aus keinen Entwurf an", async () => {
    const faelle: { grund: ErinnerungGrund; patch: Partial<ErinnerungEingabe> }[] = [
      { grund: "schalter_aus", patch: { regel: { ...due().regel, erinnerungModus: "aus" } } },
      { grund: "kein_betrag", patch: { restCent: null } },
      { grund: "bezahlt", patch: { restCent: 0 } },
      { grund: "verloren", patch: { verloren: true } },
      { grund: "meldung_offen", patch: { offeneMeldung: true } },
      { grund: "beschwerde", patch: { sperre: "complaint" } },
      { grund: "kunde_schreibt", patch: { letzteKundennachrichtAm: "2026-11-10T07:00:00.000Z" } },
      {
        grund: "noch_nicht",
        patch: { rechnung: { status: "gestellt", bruttoCent: 50000, faelligAm: "2026-11-10" } },
      },
      {
        grund: "entwurf_liegt",
        patch: { bisher: [{ stufe: 1, status: "entwurf", am: "2026-11-01T00:00:00.000Z" }] },
      },
      {
        grund: "verworfen",
        patch: { bisher: [{ stufe: 1, status: "verworfen", am: "2026-11-01T00:00:00.000Z" }] },
      },
      {
        grund: "fertig",
        patch: {
          bisher: [
            { stufe: 1, status: "gesendet", am: "2026-10-01T00:00:00.000Z" },
            { stufe: 2, status: "gesendet", am: "2026-10-20T00:00:00.000Z" },
          ],
        },
      },
      { grund: "kein_kanal", patch: { kanal: null } },
    ];
    state.kandidaten = faelle.map((f, i) => kandidat(f.patch, `inv-${i}`));
    const summary = await runZahlungserinnerung(JETZT);
    expect(summary.geprueft).toBe(faelle.length);
    expect(summary.entwuerfe).toBe(0);
    expect(summary.ohneKanal).toBe(1);
    for (const f of faelle) expect(summary.gruende[f.grund]).toBe(1);
    expect(bounds.create).not.toHaveBeenCalled();
  });

  it("wählt Ceylan-WhatsApp nie", () => {
    const jetzt = JETZT;
    const letzte = new Date(jetzt.getTime() - 2 * 60 * 60 * 1000).toISOString();
    expect(istCeylanWhatsApp(`${CEYLAN_WA_PRAEFIX}abcdef`)).toBe(true);
    expect(
      erinnerungKanal({
        whatsapp: { istCeylanKonto: true, letzteEingehendeAm: letzte },
        emailGespraech: true,
        jetzt,
      })
    ).toBe("email");
    expect(
      erinnerungKanal({
        whatsapp: { istCeylanKonto: true, letzteEingehendeAm: letzte },
        emailGespraech: false,
        jetzt,
      })
    ).toBeNull();
    expect(
      erinnerungKanal({
        whatsapp: { istCeylanKonto: false, letzteEingehendeAm: letzte },
        emailGespraech: true,
        jetzt,
      })
    ).toBe("whatsapp");
  });

  it("legt einen Entwurf mit dem Text aus geld an", async () => {
    state.kandidaten = [kandidat({})];
    const summary = await runZahlungserinnerung(JETZT);
    expect(summary.entwuerfe).toBe(1);
    expect(bounds.create).toHaveBeenCalledTimes(1);
    expect(bounds.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws1",
        conversationId: "conv-1",
        dealRecordId: "deal-1",
        messageClass: "followup",
        source: "zahlungserinnerung",
        sequenceId: "zahlungserinnerung",
        sequenceStep: 1,
        idempotencyKey: erinnerungSchluessel("inv-1", 1),
        reasoning: "Zahlungserinnerung Stufe 1",
        draftText: erinnerungText({ ...TEXT, stufe: 1 }),
        meta: {
          preisPhrase: euro(TEXT.betragCent),
          zahlungserinnerung: {
            invoiceId: "inv-1",
            stufe: 1,
            betreff: erinnerungBetreff(TEXT),
          },
        },
      })
    );
  });

  it("überspringt den Entwurf, wenn das Tageslimit des Kanals voll ist", async () => {
    state.kandidaten = [kandidat({})];
    state.channelAccountId = "acc-1";
    state.sentCount = 20;
    const summary = await runZahlungserinnerung(JETZT);
    expect(summary.entwuerfe).toBe(0);
    expect(summary.gruende.noch_nicht).toBe(1);
    expect(bounds.create).not.toHaveBeenCalled();
  });

  it("zweiter Lauf legt keinen zweiten Entwurf an", async () => {
    bounds.lade.mockImplementation(async () => [
      kandidat({
        bisher: state.inserted.map(
          (r): ErinnerungStand => ({ stufe: r.stufe as 1 | 2, status: "entwurf", am: "2026-11-10T09:00:00.000Z" })
        ),
      }),
    ]);
    const erster = await runZahlungserinnerung(JETZT);
    const zweiter = await runZahlungserinnerung(JETZT);
    expect(erster.entwuerfe).toBe(1);
    expect(zweiter.entwuerfe).toBe(0);
    expect(zweiter.gruende.entwurf_liegt).toBe(1);
    expect(bounds.create).toHaveBeenCalledTimes(1);
    expect(state.inserted).toHaveLength(1);
  });

  it("hängt die Erinnerungszeile an einen schon vorhandenen Entwurf", async () => {
    bounds.create.mockResolvedValue({
      ok: false,
      status: 409,
      error: "draft_exists",
      message: "da",
      existingDraftId: "d-alt",
    });
    state.kandidaten = [kandidat({})];
    state.syncRows = [{ key: erinnerungSchluessel("inv-1", 1) }];
    const summary = await runZahlungserinnerung(JETZT);
    expect(summary.entwuerfe).toBe(1);
    expect(state.inserted).toEqual([expect.objectContaining({ invoiceId: "inv-1", stufe: 1, draftId: "d-alt" })]);
  });

  it("ein fremder offener Entwurf (z. B. Nachfass) wird nie als Erinnerung verbucht", async () => {
    bounds.create.mockResolvedValue({ ok: false, status: 409, error: "draft_exists", message: "da", existingDraftId: "d-nachfass" });
    state.kandidaten = [kandidat({})];
    state.syncRows = [{ key: "nachfass:deal-1:a1:2026-11-10" }];
    const summary = await runZahlungserinnerung(JETZT);
    expect(summary.entwuerfe).toBe(0);
    expect(summary.gruende.entwurf_liegt).toBe(1);
    expect(state.inserted).toEqual([]);
  });

  it("stoppt die Erinnerung, wenn die Rechnung bezahlt ist", async () => {
    const row = {
      id: "r1",
      draftId: "d1",
      dealRecordId: "deal-1",
      invoiceStatus: "gestellt",
      bruttoCent: 50000,
      status: "entwurf",
      stoppGrund: null as string | null,
    };
    state.stopRows = [row];
    state.reminderRows = [row];
    state.drafts = [{ id: "d1", status: "pending" }];
    state.payments = [{ dealRecordId: "deal-1", amount: "500.00", taxTreatment: "betriebseinnahme" }];
    const summary = await runZahlungserinnerung(JETZT);
    expect(summary.gestoppt).toBe(1);
    expect(row.status).toBe("gestoppt");
    expect(row.stoppGrund).toBe("bezahlt");
    expect(state.drafts[0]?.status).toBe("superseded");
    expect(bounds.create).not.toHaveBeenCalled();
  });

  it("übernimmt gesendet und verworfen vom Entwurf", async () => {
    const gesendet = { id: "r-sent", status: "entwurf", gesendetAm: null as Date | null };
    state.reminderRows = [gesendet];
    state.syncRows = [
      {
        reminderId: "r-sent",
        draftStatus: "sent",
        reviewedAt: new Date("2026-11-10T10:00:00.000Z"),
        updatedAt: new Date("2026-11-10T10:00:00.000Z"),
      },
    ];
    await runZahlungserinnerung(JETZT);
    expect(gesendet.status).toBe("gesendet");
    expect(gesendet.gesendetAm).toEqual(new Date("2026-11-10T10:00:00.000Z"));

    reset();
    bounds.lade.mockImplementation(async () => state.kandidaten);
    const verworfen = { id: "r-no", status: "entwurf" };
    state.reminderRows = [verworfen];
    state.syncRows = [
      {
        reminderId: "r-no",
        draftStatus: "dismissed",
        reviewedAt: null,
        updatedAt: new Date("2026-11-10T10:00:00.000Z"),
      },
    ];
    await runZahlungserinnerung(JETZT);
    expect(verworfen.status).toBe("verworfen");
  });
});

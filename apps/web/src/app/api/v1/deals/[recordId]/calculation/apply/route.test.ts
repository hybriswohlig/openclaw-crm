/**
 * "In Angebot übernehmen" von Ende zu Ende über den echten Versionen-Dienst:
 * nur Speicher, Lead, Rechner und Nachlauf sind ersetzt (kein @/db).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { VersionsSpeicher, VersionsZeile } from "@/services/kalkulation-versionen";
import type { RechnerErgebnis } from "@/services/rechner/client";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  hatPaketoptionen: vi.fn(),
  ladeLeadDaten: vi.fn(),
  rufeRechner: vi.fn(),
  meldeKorrektur: vi.fn(),
  pruefeNichtAngenommen: vi.fn(),
  getQuotation: vi.fn(),
  ensureCustomerStatusLink: vi.fn(),
  captureScopeSnapshot: vi.fn(),
  completeAgentPriceTasks: vi.fn(),
  advanceDealToQuotedIfEarlier: vi.fn(),
  nachher: [] as Array<() => Promise<void>>,
  zeilen: [] as VersionsZeile[],
  speicher: null as unknown as VersionsSpeicher,
}));

vi.mock("@/db", () => ({
  db: new Proxy({}, { get(_t, p) { if (p === "then" || typeof p === "symbol") return undefined; throw new Error(`@/db im Test (${String(p)})`); } }),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (f: () => Promise<void>) => { mocks.nachher.push(f); },
}));
vi.mock("@/lib/api-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-utils")>()),
  getAuthContext: mocks.getAuthContext,
}));
vi.mock("@/services/rechner/pakete", () => ({ hatPaketoptionen: mocks.hatPaketoptionen }));
vi.mock("@/services/rechner/lead-daten", () => ({ ladeLeadDaten: mocks.ladeLeadDaten }));
vi.mock("@/services/rechner/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/rechner/client")>()),
  rufeRechner: mocks.rufeRechner,
  meldeKorrektur: mocks.meldeKorrektur,
}));
vi.mock("@/services/rechner/speicher", () => ({ dbSpeicher: { lesen: async () => null, speichern: vi.fn() } }));
vi.mock("@/services/kva-annahme", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/kva-annahme")>()),
  pruefeNichtAngenommen: mocks.pruefeNichtAngenommen,
}));
vi.mock("@/services/quotations", () => ({ getQuotation: mocks.getQuotation }));
vi.mock("@/services/kalkulation-versionen-speicher", () => ({
  get dbVersionsSpeicher() { return mocks.speicher; },
  ladePaketHebel: async () => null,
}));
vi.mock("@/services/customer-portal-data", () => ({ ensureCustomerStatusLink: mocks.ensureCustomerStatusLink }));
vi.mock("@/services/scope-guard", () => ({ captureScopeSnapshot: mocks.captureScopeSnapshot }));
vi.mock("@/services/agent/agent-tasks", () => ({ completeAgentPriceTasks: mocks.completeAgentPriceTasks }));
vi.mock("@/services/deal-attribution", () => ({ advanceDealToQuotedIfEarlier: mocks.advanceDealToQuotedIfEarlier }));

import { POST as APPLY } from "./route";
import { centSumme } from "@/services/kalkulation-versionen";
import { AngebotAngenommenError } from "@/services/kva-annahme";

const CTX = { userId: "usr_1", workspaceId: "ws_1", workspaceRole: "admin" as const };
const params = Promise.resolve({ recordId: "deal_1" });
const req = (body: unknown) =>
  new NextRequest("http://localhost/api/v1/deals/deal_1/calculation/apply", {
    method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
  });

/** Rechner: Festpreis bei 40 % Vorschlag, mit marge_prozent der Preis dazu (Selbstkosten 800). */
function rechnerAntwort(anfrage: Record<string, unknown>): { ok: true; ergebnis: RechnerErgebnis } {
  const marge = typeof anfrage.marge_prozent === "string" ? Number(anfrage.marge_prozent) : 40;
  const festpreis = Math.ceil(800 / (1 - marge / 100) / 10) * 10;
  return {
    ok: true,
    ergebnis: {
      preis: {
        festpreis, selbstkosten: 800, rundungEur: 10, margeWirksamProzent: marge, nichtKalkulierbarGrund: null,
        margeVorschlag: { prozent: 40, gruende: [] },
      },
      kosten: { selbstkosten: 800, posten: [{ key: "personal.arbeit", bezeichnung: "Personal Arbeit", menge: 10, einheit: "h", satz: 20, betrag: 200 }] },
      volumen: { nettoCbm: 20 },
      schaetzung: null,
    },
  };
}

function speicherAufbau(): VersionsSpeicher {
  const k = <T,>(x: T): T => structuredClone(x);
  const z = mocks.zeilen;
  const finde = (id: string) => z.find((x) => x.id === id && x.status === "entwurf");
  return {
    liste: async () => k(z),
    lesen: async (_ws, _deal, v) => k(z.find((x) => x.version === v) ?? null),
    entwurf: async () => k(z.find((x) => x.status === "entwurf") ?? null),
    anlegen: async (neu) => { const r = { ...k(neu), id: `id_v${neu.version}`, createdAt: new Date(), updatedAt: new Date() }; z.push(r); return k(r); },
    aktualisieren: async (id, patch) => { const r = finde(id)!; const { overrides: _o, ...f } = k(patch); Object.assign(r, f); return k(r); },
    anhaengen: async (id, u) => { const r = finde(id)!; r.overrides = [...r.overrides, k(u)]; return k(r); },
    sperrenUndAngebot: vi.fn(async (_ws, _deal, id, _angebot, kvItems, von) => {
      const r = finde(id)!;
      Object.assign(r, { status: "gesperrt", kvItems: k(kvItems), priceCents: centSumme(kvItems), lockedBy: von, lockedAt: new Date() });
      return { version: k(r) };
    }),
  };
}

const lead = {
  von: "Böblingen", nach: null, etageVon: 0, etageNach: null, zugangVon: null, zugangNach: null, umzugsdatum: null,
  wohnflaecheQm: null, zimmer: 3, tragestreckeVonM: null, tragestreckeNachM: null, halteverbot: false, packService: false, kartons: null, inventar: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.zeilen.length = 0;
  mocks.nachher.length = 0;
  mocks.speicher = speicherAufbau();
  mocks.getAuthContext.mockResolvedValue(CTX);
  mocks.hatPaketoptionen.mockResolvedValue(false);
  mocks.ladeLeadDaten.mockResolvedValue(lead);
  mocks.rufeRechner.mockImplementation(async (a: Record<string, unknown>) => rechnerAntwort(a));
  mocks.meldeKorrektur.mockResolvedValue({ ok: true });
  mocks.pruefeNichtAngenommen.mockResolvedValue(undefined);
  mocks.ensureCustomerStatusLink.mockRejectedValue(new Error("Portal aus")); // wird geschluckt
  mocks.getQuotation.mockResolvedValue({ id: "q1", notes: "Klavier", isVariable: true, validUntil: null, lineItems: [] });
});

const gesperrtesAngebot = () => vi.mocked(mocks.speicher.sperrenUndAngebot).mock.calls.at(-1)![3];

describe("POST /calculation/apply über Versionen", () => {
  it("Mensch, vorhandener Stunden-KV: Festpreis gesetzt, Notizen weitergegeben, Posten mit genau dieser Summe, Nachlauf wie beim Speichern", async () => {
    const res = await APPLY(req({}), { params });
    expect(res.status).toBe(200);
    const eingabe = gesperrtesAngebot();
    expect(eingabe).toMatchObject({ fixedPrice: "1340", isVariable: false, notes: "Klavier" });
    expect(eingabe.lineItems.reduce((s, li) => s + Number(li.unitRate) * li.quantity, 0)).toBe(1340);
    expect(mocks.zeilen[0]).toMatchObject({ version: 1, status: "gesperrt", priceCents: 134000, lockedBy: "usr_1" });
    expect(mocks.captureScopeSnapshot).toHaveBeenCalledWith("ws_1", "deal_1", "issue");
    expect(mocks.completeAgentPriceTasks).toHaveBeenCalledWith("ws_1", "deal_1");
    expect(mocks.advanceDealToQuotedIfEarlier).toHaveBeenCalledWith({
      workspaceId: "ws_1", dealRecordId: "deal_1", reason: "Kalkulation ins Angebot übernommen",
    });
    expect((await res.json()).data).toMatchObject({ id: "q1", gueltigkeitHinweis: null });
  });

  it("Agent mit vorhandenem Stunden-KV: 400 (STUNDEN), nichts gesperrt", async () => {
    mocks.getAuthContext.mockResolvedValue({ ...CTX, authMethod: "api_key" });
    const res = await APPLY(req({}), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/Stunden-KV/);
    expect(mocks.speicher.sperrenUndAngebot).not.toHaveBeenCalled();
  });

  it("mit Margenwahl: Marge geht an den Rechner, Meldung regel marge; danach ohne Margenwahl gilt wieder der Vorschlag wie auf der Karte", async () => {
    mocks.getQuotation.mockResolvedValue(null);
    expect((await APPLY(req({ margeProzent: 50 }), { params })).status).toBe(200);
    expect(gesperrtesAngebot().fixedPrice).toBe("1600");
    expect(mocks.zeilen[0].overrides.map((u) => u.wert)).toEqual([50]);
    for (const f of mocks.nachher.splice(0)) await f();
    expect(mocks.meldeKorrektur).toHaveBeenCalledWith(expect.objectContaining({ regel: "marge", rechnerwert: 40, inhaberwert: 50 }));

    // v2 erbt die Marge 50; ohne Margenwahl wird sie aufgehoben → Vorschlag 40 % wie angezeigt.
    expect((await APPLY(req({}), { params })).status).toBe(200);
    const v2 = mocks.zeilen.find((z) => z.version === 2)!;
    expect(v2.overrides.map((u) => [u.wert, u.grund])).toEqual([
      [50, "Marge im Regler gewählt"],
      [null, "Kalkulationskarte ohne Margenwahl: Vorschlag des Rechners"],
    ]);
    expect(v2.rechnerRequest?.marge_prozent).toBeUndefined();
    expect(gesperrtesAngebot().fixedPrice).toBe("1340");
  });

  it("mit Margenwahl auf geerbter Marge: keine Aufhebung, die neue Marge gilt", async () => {
    mocks.getQuotation.mockResolvedValue(null);
    await APPLY(req({ margeProzent: 50 }), { params });
    await APPLY(req({ margeProzent: 45 }), { params });
    const v2 = mocks.zeilen.find((z) => z.version === 2)!;
    expect(v2.overrides.map((u) => u.wert)).toEqual([50, 45]);
    expect(gesperrtesAngebot().fixedPrice).toBe("1460");
  });

  it("ohne Margenwahl und ohne geerbte Marge: keine Übersteuerung", async () => {
    mocks.getQuotation.mockResolvedValue(null);
    await APPLY(req({}), { params });
    expect(mocks.zeilen[0].overrides).toEqual([]);
    expect(mocks.nachher).toHaveLength(0);
  });

  it("Kundenannahme: 409 KVA_ACCEPTED, Version bleibt Entwurf", async () => {
    mocks.pruefeNichtAngenommen.mockRejectedValue(new AngebotAngenommenError());
    const res = await APPLY(req({}), { params });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("KVA_ACCEPTED");
    expect(mocks.zeilen[0].status).toBe("entwurf");
  });
});

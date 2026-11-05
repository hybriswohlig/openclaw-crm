import { describe, expect, it, vi } from "vitest";

// Kein Zugriff auf die Datenbank: jeder Zugriff auf `db` lässt den Test scheitern.
vi.mock("@/db", () => ({
  db: new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then" || typeof prop === "symbol") return undefined;
        throw new Error(`@/db im Test benutzt (${String(prop)})`);
      },
    }
  ),
}));

import { quotationLineItems, quotations } from "@/db/schema/quotations";
import { UebersteuerungFehler } from "@/lib/kalkulation-versionen";
import { AngebotAngenommenError } from "./kva-annahme";
import { angebotAusVersionSchreiben, type AngebotsEingabe, type Quotation } from "./quotations";
import type { RechnerAntwort, RechnerErgebnis } from "./rechner/client";
import { rechnerAnfrageAus, type LeadDaten } from "./rechner/eingabe";
import type { KalkulationsZeile } from "./rechner/kalkulation";
import {
  centSumme,
  EntwurfExistiertError,
  entwurfHolenOderAnlegen,
  sperren,
  uebersteuern,
  VersionsFehler,
  type Autor,
  type VersionsSpeicher,
  type VersionsZeile,
} from "./kalkulation-versionen";

const MENSCH: Autor = { userId: "usr_1", quelle: "mensch" };
const AGENT: Autor = { userId: null, quelle: "agent" };

const lead = (zimmer: number): LeadDaten => ({
  von: "Böblingen", nach: null, etageVon: 0, etageNach: null, zugangVon: null, zugangNach: null,
  umzugsdatum: null, wohnflaecheQm: null, zimmer, tragestreckeVonM: null, tragestreckeNachM: null,
  halteverbot: false, packService: false, kartons: null, inventar: [],
});

const ergebnis = (festpreis = 1490): RechnerErgebnis => ({
  preis: {
    festpreis, selbstkosten: 800, rundungEur: 10, margeWirksamProzent: 40, nichtKalkulierbarGrund: null,
    margeVorschlag: { prozent: 40, gruende: [{ text: "Basis", punkte: 40 }] },
  },
  kosten: {
    selbstkosten: 800,
    posten: [
      { key: "personal.arbeit", bezeichnung: "Personal Arbeit", menge: 10, einheit: "h", satz: 20, betrag: 200, formel: "10 Personenstunden × 20,00 €/h" },
      { key: "halteverbot", bezeichnung: "Halteverbotszone", menge: 1, einheit: "Zone", satz: 150, betrag: 150 },
    ],
  },
  volumen: { nettoCbm: 20 },
  tarif: { id: "t1", version: 3, marke: "kottke" },
  schaetzung: null,
});

const angebot = (felder: Partial<Quotation> = {}): Quotation =>
  ({ id: "q1", notes: "Klavier", isVariable: false, validUntil: null, lineItems: [], ...felder }) as Quotation;

function aufbau(start = "2026-11-05T09:00:00Z") {
  const zeilen: VersionsZeile[] = [];
  const kopie = <T>(x: T): T => structuredClone(x);
  let vorAnlegen: (() => void) | null = null;
  let beimAnhaengen: ((z: VersionsZeile) => void) | null = null;
  let jetzt = new Date(start);
  let antwort: RechnerAntwort = { ok: true, ergebnis: ergebnis() };
  let aktuellerLead = lead(3);
  const nachherJobs: Array<() => Promise<void>> = [];

  const speicher: VersionsSpeicher = {
    liste: async (ws, deal) => kopie(zeilen.filter((z) => z.workspaceId === ws && z.dealRecordId === deal).sort((a, b) => a.version - b.version)),
    lesen: async (ws, deal, v) => kopie(zeilen.find((z) => z.workspaceId === ws && z.dealRecordId === deal && z.version === v) ?? null),
    entwurf: async (ws, deal) => kopie(zeilen.find((z) => z.workspaceId === ws && z.dealRecordId === deal && z.status === "entwurf") ?? null),
    anlegen: vi.fn(async (z) => {
      if (vorAnlegen) { const f = vorAnlegen; vorAnlegen = null; f(); }
      if (zeilen.some((x) => x.dealRecordId === z.dealRecordId && x.status === "entwurf")) throw new EntwurfExistiertError();
      const neu: VersionsZeile = { ...kopie(z), id: `id_v${z.version}`, createdAt: jetzt, updatedAt: jetzt };
      zeilen.push(neu);
      return kopie(neu);
    }),
    aktualisieren: vi.fn(async (id, patch) => {
      const z = zeilen.find((x) => x.id === id);
      if (!z || z.status !== "entwurf") throw new VersionsFehler("UNGUELTIG", "Version ist bereits gesperrt.");
      const { overrides: _ignoriert, ...felder } = kopie(patch);
      Object.assign(z, felder, { updatedAt: jetzt });
      return kopie(z);
    }),
    anhaengen: vi.fn(async (id, u) => {
      const z = zeilen.find((x) => x.id === id);
      if (!z || z.status !== "entwurf") throw new VersionsFehler("UNGUELTIG", "Version ist bereits gesperrt.");
      z.overrides = [...z.overrides, kopie(u)];
      if (beimAnhaengen) { const f = beimAnhaengen; beimAnhaengen = null; f(z); }
      return kopie(z);
    }),
    sperrenUndAngebot: vi.fn(async (_ws, _deal, id, _angebot, kvItems, von, stand) => {
      const z = zeilen.find((x) => x.id === id && x.status === "entwurf");
      if (!z) throw new VersionsFehler("UNGUELTIG", "Version ist bereits gesperrt.");
      if (stand && z.overrides.length !== stand.uebersteuerungen) throw new VersionsFehler("UNGUELTIG", "Die Kalkulation wurde gerade geändert. Bitte erneut sperren.");
      if (stand?.schnappschuss) Object.assign(z, kopie(stand.schnappschuss), { error: null });
      Object.assign(z, { status: "gesperrt", kvItems: kopie(kvItems), priceCents: centSumme(kvItems), lockedAt: jetzt, lockedBy: von });
      return { version: kopie(z) };
    }),
  };

  const rechner = vi.fn(async () => antwort);
  const melde = vi.fn(async () => ({ ok: true as const }));
  const deps = {
    speicher,
    rechner,
    melde,
    jetzt: () => jetzt,
    ladeLead: vi.fn(async () => aktuellerLead),
    nachher: (f: () => Promise<void>) => { nachherJobs.push(f); },
    pruefeAnnahme: vi.fn(async () => undefined),
    hatPakete: vi.fn(async () => false),
    ladePaketHebel: vi.fn(async () => null),
    ladeAngebot: vi.fn(async (): Promise<Quotation | null> => null),
    ladeCache: vi.fn(async (): Promise<KalkulationsZeile | null> => null),
    nachSperren: vi.fn(async () => undefined),
  };

  /** Gesperrte oder Entwurfs-Version direkt in den Speicher legen. */
  const lege = (version: number, felder: Partial<VersionsZeile> = {}): VersionsZeile => {
    const z: VersionsZeile = {
      id: `id_v${version}`, workspaceId: "ws", dealRecordId: "deal1", version, status: "gesperrt", pricingMode: "fest",
      referenceDate: "2026-11-01", inputs: [], overrides: [], rechnerRequest: rechnerAnfrageAus(lead(3), { heute: "2026-11-01" }),
      rechnerResult: ergebnis(), error: null, costLines: [], margin: null, priceCents: 149000, packagePrices: [], kvItems: [],
      tariff: { id: "t1", version: 3, marke: "kottke" }, vehicleBookingId: null, createdBy: null, createdAt: jetzt, updatedAt: jetzt,
      lockedAt: jetzt, lockedBy: "usr_1", sentAt: null, sentVia: null, ...felder,
    };
    zeilen.push(z);
    return kopie(z);
  };

  return {
    zeilen, deps, speicher, rechner, melde, lege, nachherJobs,
    setzeJetzt: (iso: string) => { jetzt = new Date(iso); },
    setzeAntwort: (a: RechnerAntwort) => { antwort = a; },
    setzeLead: (l: LeadDaten) => { aktuellerLead = l; },
    beimAnlegen: (f: () => void) => { vorAnlegen = f; },
    /** Simuliert einen zweiten Bot, der beim Anhängen dazwischenkommt. */
    beimAnhaengen: (f: (z: VersionsZeile) => void) => { beimAnhaengen = f; },
    alleNachher: async () => { for (const f of nachherJobs.splice(0)) await f(); },
  };
}

const ueberHalteverbot = { art: "zeile", key: "halteverbot", wert: 0, grund: "Kunde besorgt Halteverbot selbst" };
const fruehereUebersteuerung = {
  id: "u_alt", art: "marge" as const, key: "marge", rechnerwert: 40, wert: 45, grund: "Stammkunde",
  autor: { userId: "usr_1", quelle: "mensch" as const }, zeit: "2026-11-01T10:00:00.000Z", fotoRef: null,
};

describe("entwurfHolenOderAnlegen", () => {
  it("ohne Versionen: v1 Entwurf mit Bezugsdatum heute, Rechner einmal; zweiter Aufruf gibt denselben Entwurf zurück", async () => {
    const t = aufbau();
    const r = await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    expect(r.neu).toBe(true);
    expect(r.version).toMatchObject({
      version: 1, status: "entwurf", pricingMode: "fest", referenceDate: "2026-11-05", error: null, priceCents: 149000,
      createdBy: "usr_1", tariff: { id: "t1", version: 3, marke: "kottke" },
      margin: { vorschlagProzent: 40, gruende: [{ text: "Basis", punkte: 40 }], gewaehltProzent: null },
    });
    expect(r.version.rechnerRequest?.heute).toBe("2026-11-05");
    expect(r.version.costLines.map((z) => z.key)).toEqual(["personal.arbeit", "halteverbot"]);
    expect(r.version.inputs.length).toBeGreaterThan(0);
    expect(t.rechner).toHaveBeenCalledTimes(1);

    const zweiter = await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    expect(zweiter.neu).toBe(false);
    expect(zweiter.version.id).toBe(r.version.id);
    expect(t.rechner).toHaveBeenCalledTimes(1);
  });

  it("Speicher meldet EntwurfExistiertError (zweiter Bot war schneller): Ergebnis ist der vorhandene Entwurf (Review Focus 2)", async () => {
    const t = aufbau();
    t.beimAnlegen(() => { t.lege(1, { status: "entwurf", id: "id_fremd", lockedAt: null, lockedBy: null }); });
    const r = await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    expect(r).toMatchObject({ neu: false, version: { id: "id_fremd", status: "entwurf" } });
    expect(t.zeilen.filter((z) => z.status === "entwurf")).toHaveLength(1);
  });

  it("Entwurf-Konflikt, der andere Entwurf ist schon gesperrt: einmal mit der nächsten Nummer, sonst sauberer Fehler", async () => {
    const t = aufbau();
    const original = vi.mocked(t.speicher.anlegen).getMockImplementation()!;
    vi.mocked(t.speicher.anlegen).mockImplementationOnce(async () => {
      t.lege(1); // Gewinner hat v1 schon gesperrt
      throw new EntwurfExistiertError();
    });
    const r = await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    expect(r).toMatchObject({ neu: true, version: { version: 2, status: "entwurf" } });

    const t2 = aufbau();
    vi.mocked(t2.speicher.anlegen).mockRejectedValue(new EntwurfExistiertError());
    await expect(entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t2.deps)).rejects.toMatchObject({
      code: "UNGUELTIG", message: "Die Kalkulation wurde gerade geändert. Bitte erneut versuchen.",
    });
    expect(original).toBeDefined();
  });

  it("andere Fehler beim Anlegen werden weitergeworfen", async () => {
    const t = aufbau();
    vi.mocked(t.speicher.anlegen).mockRejectedValueOnce(new Error("DB weg"));
    await expect(entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps)).rejects.toThrow("DB weg");
  });

  it("nach gesperrten Versionen: Nummer max + 1, Übersteuerungen der letzten gesperrten Version", async () => {
    const t = aufbau();
    t.lege(1);
    t.lege(2, { overrides: [fruehereUebersteuerung] });
    const r = await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    expect(r.version.version).toBe(3);
    expect(r.version.overrides).toEqual([fruehereUebersteuerung]);
    expect(r.version.rechnerRequest?.marge_prozent).toBe("45");
    expect(r.version.margin?.gewaehltProzent).toBe(45);
  });

  it("nutzt die Live-Kalkulation, wenn Anfrage (ohne heute) und Tag gleich sind", async () => {
    const t = aufbau();
    const cacheErgebnis = ergebnis(1590);
    const cache = (heute: string, ws = "ws"): KalkulationsZeile => ({
      dealRecordId: "deal1", workspaceId: ws, inputHash: "h", request: rechnerAnfrageAus(lead(3), { heute }),
      result: cacheErgebnis, error: null, computedAt: new Date(),
    });
    t.deps.ladeCache.mockResolvedValueOnce(cache("2026-11-05"));
    const r = await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    expect(t.rechner).not.toHaveBeenCalled();
    expect(r.version.rechnerResult).toEqual(cacheErgebnis);
    expect(r.version.priceCents).toBe(159000);
  });

  it("Live-Kalkulation von gestern oder aus einem anderen Workspace wird nicht genutzt", async () => {
    for (const [heute, ws] of [["2026-11-04", "ws"], ["2026-11-05", "ws_fremd"]] as const) {
      const t = aufbau();
      t.deps.ladeCache.mockResolvedValueOnce({
        dealRecordId: "deal1", workspaceId: ws, inputHash: "h", request: rechnerAnfrageAus(lead(3), { heute }),
        result: ergebnis(1590), error: null, computedAt: new Date(),
      });
      await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
      expect(t.rechner).toHaveBeenCalledTimes(1);
    }
  });

  it("Deal mit Paketoptionen: Anfrage enthält die Hebel der aktiven Pakete", async () => {
    const t = aufbau();
    t.deps.hatPakete.mockResolvedValue(true);
    t.deps.ladePaketHebel.mockResolvedValue({ basis: [], komfort: ["montage", "halteverbot"] } as never);
    const r = await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    expect(t.deps.ladePaketHebel).toHaveBeenCalledWith("ws", "deal1");
    expect(JSON.parse(r.version.rechnerRequest?.paket_hebel as string)).toEqual({ basis: [], komfort: ["montage", "halteverbot"] });
  });

  it("Rechner nicht erreichbar beim Anlegen: Entwurf mit Fehler, ohne Ergebnis", async () => {
    const t = aufbau();
    t.setzeAntwort({ ok: false, fehler: "Rechner nicht erreichbar." });
    const r = await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    expect(r.version).toMatchObject({ version: 1, error: "Rechner nicht erreichbar.", rechnerResult: null, priceCents: null });
  });

  it("unbekannter Deal: NICHT_GEFUNDEN", async () => {
    const t = aufbau();
    t.deps.ladeLead.mockResolvedValueOnce(null as never);
    await expect(entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps)).rejects.toMatchObject({ code: "NICHT_GEFUNDEN", status: 404 });
  });
});

describe("uebersteuern", () => {
  it("an gesperrter v2 ohne Entwurf: v3 Entwurf mit allen Übersteuerungen von v2 plus der neuen, v2 unverändert (Review Focus 1)", async () => {
    const t = aufbau();
    t.lege(1);
    const v2 = t.lege(2, { overrides: [fruehereUebersteuerung] });
    const r = await uebersteuern("ws", "deal1", 2, ueberHalteverbot, MENSCH, t.deps);
    expect(r.neu).toBe(true);
    expect(r.version).toMatchObject({ version: 3, status: "entwurf" });
    expect(r.version.overrides).toHaveLength(v2.overrides.length + 1);
    expect(r.version.overrides[0]).toEqual(fruehereUebersteuerung);
    expect(r.version.overrides[1]).toMatchObject({
      art: "zeile", key: "halteverbot", wert: 0, rechnerwert: 150, grund: "Kunde besorgt Halteverbot selbst",
      autor: MENSCH, zeit: "2026-11-05T09:00:00.000Z", fotoRef: null,
    });
    expect(r.version.overrides[1].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.version.rechnerRequest?.zeilen_uebersteuerung).toEqual([{ key: "halteverbot", betrag: 0 }]);
    expect(t.zeilen.find((z) => z.version === 2)).toEqual(v2);

    // Mit vorhandenem Entwurf v3 landet die nächste Übersteuerung dort, keine v4.
    const zweite = await uebersteuern("ws", "deal1", 2, { art: "satz", key: "arbeit", wert: 22, grund: "Wochenende" }, MENSCH, t.deps);
    expect(zweite.neu).toBe(false);
    expect(zweite.version.version).toBe(3);
    expect(zweite.version.overrides).toHaveLength(3);
    expect(t.zeilen.map((z) => z.version)).toEqual([1, 2, 3]);
    expect(t.zeilen.find((z) => z.version === 2)).toEqual(v2);
  });

  it("Übersteuerungen werden nur angehängt, in Reihenfolge, die letzte gilt", async () => {
    const t = aufbau();
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    await uebersteuern("ws", "deal1", 1, { art: "marge", key: "marge", wert: 45, grund: "a" }, MENSCH, t.deps);
    const r = await uebersteuern("ws", "deal1", 1, { art: "marge", key: "marge", wert: 50, grund: "b" }, MENSCH, t.deps);
    expect(r.version.overrides.map((u) => u.wert)).toEqual([45, 50]);
    expect(r.version.rechnerRequest?.marge_prozent).toBe("50");
    expect(r.version.margin?.gewaehltProzent).toBe(50);
  });

  it("Rechner nicht erreichbar: error gesetzt, altes Ergebnis bleibt; Sperren → RECHNER_FEHLER ohne Quotation (Review Focus 3)", async () => {
    const t = aufbau();
    const { version: v1 } = await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    t.setzeAntwort({ ok: false, fehler: "Rechner nicht erreichbar." });
    const r = await uebersteuern("ws", "deal1", 1, ueberHalteverbot, MENSCH, t.deps);
    expect(r.version.error).toBe("Rechner nicht erreichbar.");
    expect(r.version.rechnerResult).toEqual(v1.rechnerResult);
    expect(r.version.overrides).toHaveLength(1);

    const fehler = await sperren("ws", "deal1", 1, MENSCH, {}, t.deps).catch((e: unknown) => e);
    expect(fehler).toBeInstanceOf(VersionsFehler);
    expect(fehler).toMatchObject({ code: "RECHNER_FEHLER", status: 409 });
    expect((fehler as Error).message).toMatch(/nicht erreichbar/);
    expect(t.speicher.sperrenUndAngebot).not.toHaveBeenCalled();
    expect(t.zeilen[0].status).toBe("entwurf");
  });

  it("meldet die Korrektur nach der Antwort: Rechnerwert vor der Änderung, neuer Wert; Meldefehler wirft nicht", async () => {
    const t = aufbau();
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    t.melde.mockResolvedValue({ ok: false, fehler: "Rechner-Fehler (HTTP 500)." } as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await uebersteuern("ws", "deal1", 1, { ...ueberHalteverbot, fotoRef: "foto_9" }, MENSCH, t.deps);
    expect(t.melde).not.toHaveBeenCalled();
    expect(t.nachherJobs).toHaveLength(1);
    await expect(t.alleNachher()).resolves.toBeUndefined();
    expect(t.melde).toHaveBeenCalledTimes(1);
    expect(t.melde).toHaveBeenCalledWith(
      expect.objectContaining({
        crm_deal_record_id: "deal1", crm_version: 1, tarif_id: "t1", tarif_version: 3, marke: "kottke",
        regel: "zeile", zeile_key: "halteverbot", rechnerwert: 150, inhaberwert: 0,
        grund: "Kunde besorgt Halteverbot selbst", autor: "usr_1", foto_ref: "foto_9",
      })
    );
    const [meldung] = t.melde.mock.calls[0] as unknown as [{ eingaben: Record<string, unknown> }];
    expect(meldung.eingaben.zeilen_uebersteuerung).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("Agent ohne Nutzer meldet als autor \"agent\"; ein Wurf beim Melden bleibt im Hintergrund", async () => {
    const t = aufbau();
    await entwurfHolenOderAnlegen("ws", "deal1", AGENT, t.deps);
    t.melde.mockRejectedValue(new Error("kaputt") as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await uebersteuern("ws", "deal1", 1, { art: "marge", key: "marge", wert: 45, grund: "Regler" }, AGENT, t.deps);
    await expect(t.alleNachher()).resolves.toBeUndefined();
    expect(t.melde).toHaveBeenCalledWith(expect.objectContaining({ autor: "agent", regel: "marge", rechnerwert: 40, inhaberwert: 45 }));
    warn.mockRestore();
  });

  it("unbekannte Kostenzeile, fehlender Grund und unbekannte Version werden abgelehnt", async () => {
    const t = aufbau();
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    await expect(uebersteuern("ws", "deal1", 1, { ...ueberHalteverbot, key: "fahrzeug.x.miete" }, MENSCH, t.deps)).rejects.toThrow(
      new UebersteuerungFehler("Unbekannte Kostenzeile: fahrzeug.x.miete")
    );
    await expect(uebersteuern("ws", "deal1", 1, { ...ueberHalteverbot, grund: " " }, MENSCH, t.deps)).rejects.toThrow("Grund fehlt");
    await expect(uebersteuern("ws", "deal1", 9, ueberHalteverbot, MENSCH, t.deps)).rejects.toMatchObject({ code: "NICHT_GEFUNDEN", status: 404 });
    expect(t.zeilen[0].overrides).toEqual([]);
  });

  it("hängt atomar an und rechnet mit der Liste, die der Speicher zurückgibt (auch parallel angehängte)", async () => {
    const t = aufbau();
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    t.beimAnhaengen((z) => {
      z.overrides.push({ ...fruehereUebersteuerung, id: "u_bot2", art: "satz", key: "arbeit", wert: 25, rechnerwert: 20 });
    });
    const r = await uebersteuern("ws", "deal1", 1, ueberHalteverbot, MENSCH, t.deps);
    expect(t.speicher.anhaengen).toHaveBeenCalledWith("id_v1", expect.objectContaining({ art: "zeile", key: "halteverbot" }));
    expect(vi.mocked(t.speicher.aktualisieren).mock.calls.at(-1)?.[1]).not.toHaveProperty("overrides");
    expect(r.version.overrides.map((u) => u.key)).toEqual(["halteverbot", "arbeit"]);
    expect(r.version.rechnerRequest).toMatchObject({ satz_arbeit: "25", zeilen_uebersteuerung: [{ key: "halteverbot", betrag: 0 }] });
  });

  it("Zurücknehmen (wert null) meldet keine Korrektur; Marge wird gegen den Vorschlag des Rechners gemeldet", async () => {
    const t = aufbau();
    // Ergebnis mit Inhaber-Marge 50 gerechnet, Vorschlag des Rechners 40.
    t.setzeAntwort({ ok: true, ergebnis: { ...ergebnis(1600), preis: { ...ergebnis(1600).preis!, margeWirksamProzent: 50 } } });
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    const r = await uebersteuern("ws", "deal1", 1, { art: "marge", key: "marge", wert: 45, grund: "Stammkunde" }, MENSCH, t.deps);
    expect(r.version.overrides[0].rechnerwert).toBe(40);
    await uebersteuern("ws", "deal1", 1, { art: "marge", key: "marge", wert: null, grund: "zurück" }, MENSCH, t.deps);
    await uebersteuern("ws", "deal1", 1, { ...ueberHalteverbot, wert: null }, MENSCH, t.deps).catch(() => undefined);
    await t.alleNachher();
    expect(t.melde).toHaveBeenCalledTimes(1);
    expect(t.melde).toHaveBeenCalledWith(expect.objectContaining({ regel: "marge", rechnerwert: 40, inhaberwert: 45 }));
  });

  it("jede Übersteuerung meldet; die zweite derselben Zeile mit dem ursprünglichen Rechnerwert (R→X, dann R→Y)", async () => {
    const t = aufbau();
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    await uebersteuern("ws", "deal1", 1, ueberHalteverbot, MENSCH, t.deps);
    // Der Rechner liefert die übersteuerte Zeile jetzt mit dem Inhaberwert 0.
    t.setzeAntwort({ ok: true, ergebnis: { ...ergebnis(), kosten: { selbstkosten: 650, posten: [{ ...ergebnis().kosten!.posten![1], betrag: 0, quelle: "uebersteuert" }] } } });
    await uebersteuern("ws", "deal1", 1, { ...ueberHalteverbot, wert: 50, grund: "Halbe Zone" }, MENSCH, t.deps);
    const r = await uebersteuern("ws", "deal1", 1, { ...ueberHalteverbot, wert: 80, grund: "doch mehr" }, MENSCH, t.deps);
    await t.alleNachher();
    expect(t.melde.mock.calls.map((c) => { const m = (c as unknown[])[0] as { rechnerwert: number; inhaberwert: number }; return [m.rechnerwert, m.inhaberwert]; })).toEqual([
      [150, 0], [150, 50], [150, 80],
    ]);
    expect(r.version.overrides.map((u) => u.rechnerwert)).toEqual([150, 150, 150]);
  });

  it("Rücknahme einer Zeilen-Übersteuerung geht auch am Entwurf ohne Ergebnis", async () => {
    const t = aufbau();
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    await uebersteuern("ws", "deal1", 1, ueberHalteverbot, MENSCH, t.deps);
    t.zeilen[0].rechnerResult = null; // z. B. Entwurf neu angelegt, während der Rechner ausfiel
    const r = await uebersteuern("ws", "deal1", 1, { ...ueberHalteverbot, wert: null, grund: "zurück" }, MENSCH, t.deps);
    expect(r.version.overrides.map((u) => u.wert)).toEqual([0, null]);
    expect(r.version.rechnerRequest?.zeilen_uebersteuerung).toBeUndefined();
  });

  it("Zeilen-Übersteuerung ohne Ergebnis im Entwurf: Kalkulation liegt noch nicht vor", async () => {
    const t = aufbau();
    t.setzeAntwort({ ok: false, fehler: "Rechner nicht erreichbar." });
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    await expect(uebersteuern("ws", "deal1", 1, ueberHalteverbot, MENSCH, t.deps)).rejects.toMatchObject({
      code: "RECHNER_FEHLER", message: "Die Kalkulation liegt noch nicht vor. Bitte zuerst neu rechnen.",
    });
  });

  it("Entwurf wird zwischen Lesen und Anhängen gesperrt: Übersteuerung landet im neuen Entwurf", async () => {
    const t = aufbau();
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    const original = vi.mocked(t.speicher.anhaengen).getMockImplementation()!;
    vi.mocked(t.speicher.anhaengen).mockImplementationOnce(async (id, u) => {
      t.zeilen[0].status = "gesperrt";
      return original(id, u);
    });
    const r = await uebersteuern("ws", "deal1", 1, ueberHalteverbot, MENSCH, t.deps);
    expect(r).toMatchObject({ neu: true, version: { version: 2, status: "entwurf" } });
    expect(r.version.overrides.map((u) => u.key)).toEqual(["halteverbot"]);
    expect(t.zeilen[0].overrides).toEqual([]);
  });

  it("Entwurf wird nach dem Anhängen gesperrt: Ergebnis ist die gesperrte Version mit der Übersteuerung", async () => {
    const t = aufbau();
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    const original = vi.mocked(t.speicher.aktualisieren).getMockImplementation()!;
    vi.mocked(t.speicher.aktualisieren).mockImplementationOnce(async (id, patch) => {
      t.zeilen[0].status = "gesperrt";
      return original(id, patch);
    });
    const r = await uebersteuern("ws", "deal1", 1, ueberHalteverbot, MENSCH, t.deps);
    expect(r.version).toMatchObject({ version: 1, status: "gesperrt" });
    expect(r.version.overrides.map((u) => u.key)).toEqual(["halteverbot"]);
  });

  it("Aufheben einer Zeilen-Übersteuerung geht auch, wenn der Rechner die Zeile nicht mehr liefert", async () => {
    const t = aufbau();
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    await uebersteuern("ws", "deal1", 1, ueberHalteverbot, MENSCH, t.deps);
    t.setzeAntwort({ ok: true, ergebnis: { ...ergebnis(), kosten: { selbstkosten: 800, posten: [] } } });
    await uebersteuern("ws", "deal1", 1, { art: "satz", key: "arbeit", wert: 22, grund: "x" }, MENSCH, t.deps);
    const r = await uebersteuern("ws", "deal1", 1, { ...ueberHalteverbot, wert: null }, MENSCH, t.deps);
    expect(r.version.overrides).toHaveLength(3);
    expect(r.version.rechnerRequest?.zeilen_uebersteuerung).toBeUndefined();
  });

  it("Folie 30 €, Kartons 80 €: Kostenzeile material_frei.0 nicht übersteuerbar, Entfernen der Folie lässt Kartons bei 80 € (Review 5)", async () => {
    const t = aufbau();
    // Der Rechner liefert das freie Material als Kostenzeilen nach Position.
    t.setzeAntwort({
      ok: true,
      ergebnis: {
        ...ergebnis(),
        kosten: {
          selbstkosten: 910,
          posten: [
            ...ergebnis().kosten!.posten!,
            { key: "material_frei.0", bezeichnung: "Folie", menge: 1, einheit: "pauschal", satz: 30, betrag: 30 },
            { key: "material_frei.1", bezeichnung: "Kartons", menge: 1, einheit: "pauschal", satz: 80, betrag: 80 },
          ],
        },
      },
    });
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    await uebersteuern("ws", "deal1", 1, { art: "material_frei", key: "folie", wert: { bezeichnung: "Folie", betrag: 30 }, grund: "Foto" }, MENSCH, t.deps);
    await uebersteuern("ws", "deal1", 1, { art: "material_frei", key: "kartons", wert: { bezeichnung: "Kartons", betrag: 80 }, grund: "Foto" }, MENSCH, t.deps);

    await expect(
      uebersteuern("ws", "deal1", 1, { art: "zeile", key: "material_frei.0", wert: 5, grund: "Folie günstiger" }, MENSCH, t.deps)
    ).rejects.toThrow(new UebersteuerungFehler("Freies Material bitte über material_frei ändern, nicht über die Kostenzeile."));
    expect(t.speicher.anhaengen).toHaveBeenCalledTimes(2);

    const r = await uebersteuern("ws", "deal1", 1, { art: "material_frei", key: "folie", wert: null, grund: "doch keine Folie" }, MENSCH, t.deps);
    expect(r.version.rechnerRequest?.material_frei).toEqual([{ bezeichnung: "Kartons", betrag: 80 }]);
    expect(r.version.rechnerRequest?.zeilen_uebersteuerung).toBeUndefined();
    expect(r.version.overrides.some((u) => u.art === "zeile")).toBe(false);
  });
});

describe("sperren", () => {
  it("sperrt den Entwurf: kv_items = Posten der Übernahme, price_cents = Cent-Summe, Nachlauf, Quotation nach dem Commit", async () => {
    const t = aufbau();
    t.deps.ladeAngebot.mockResolvedValue(angebot());
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    const r = await sperren("ws", "deal1", 1, MENSCH, {}, t.deps);

    expect(t.rechner).toHaveBeenCalledTimes(1); // frisch: keine zweite Rechnung
    expect(t.speicher.sperrenUndAngebot).toHaveBeenCalledTimes(1);
    const [ws, deal, id, eingabe, kvItems, von] = vi.mocked(t.speicher.sperrenUndAngebot).mock.calls[0];
    expect([ws, deal, id, von]).toEqual(["ws", "deal1", "id_v1", "usr_1"]);
    expect(eingabe).toMatchObject({ isVariable: false, notes: "Klavier", calculationAssumptions: { uebernommenVon: "mensch" } });
    expect(kvItems).toEqual(eingabe.lineItems.map((li) => ({ description: li.description, quantity: li.quantity, unitRate: Number(li.unitRate) })));
    const summe = kvItems.reduce((s, p) => s + Math.round(p.unitRate * 100) * p.quantity, 0);
    expect(summe).toBe(149000);

    expect(r.version).toMatchObject({ status: "gesperrt", priceCents: summe, lockedBy: "usr_1" });
    expect(r.version.kvItems).toEqual(kvItems);
    expect(r.quotation).toMatchObject({ id: "q1" });
    expect(r).toHaveProperty("gueltigkeitHinweis");
    expect(t.deps.nachSperren).toHaveBeenCalledWith("ws", "deal1", MENSCH);
    expect(vi.mocked(t.deps.nachSperren).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(t.speicher.sperrenUndAngebot).mock.invocationCallOrder[0]
    );
  });

  it("Agent: Übernahme als agent vermerkt", async () => {
    const t = aufbau();
    await entwurfHolenOderAnlegen("ws", "deal1", AGENT, t.deps);
    await sperren("ws", "deal1", 1, AGENT, {}, t.deps);
    const eingabe = vi.mocked(t.speicher.sperrenUndAngebot).mock.calls[0][3];
    expect(eingabe.calculationAssumptions).toMatchObject({ uebernommenVon: "agent" });
  });

  it("veralteter Entwurf (vom 03.11., Lead seither geändert): genau eine neue Rechnung, gesperrt wird das neue Ergebnis vom 05.11.", async () => {
    const t = aufbau("2026-11-03T09:00:00Z");
    const { version: alt } = await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    expect(alt.referenceDate).toBe("2026-11-03");
    t.setzeLead(lead(4));
    t.setzeJetzt("2026-11-05T09:00:00Z");
    t.setzeAntwort({ ok: true, ergebnis: ergebnis(1690) });
    t.rechner.mockClear();

    const r = await sperren("ws", "deal1", 1, MENSCH, {}, t.deps);
    expect(t.rechner).toHaveBeenCalledTimes(1);
    expect(r.version).toMatchObject({ status: "gesperrt", referenceDate: "2026-11-05", priceCents: 169000 });
    expect(r.version.rechnerRequest?.heute).toBe("2026-11-05");
    expect(r.version.rechnerResult?.preis?.festpreis).toBe(1690);
    expect(vi.mocked(t.speicher.sperrenUndAngebot).mock.calls[0][3].fixedPrice).toBe("1690");
  });

  it("parallel angehängte Übersteuerung nach der Neuberechnung: Sperren vergleicht mit der aktuellen Liste und rechnet neu", async () => {
    const t = aufbau();
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    await uebersteuern("ws", "deal1", 1, ueberHalteverbot, MENSCH, t.deps);
    // Zweiter Bot hat angehängt, sein Ergebnis ist noch nicht geschrieben: Liste hat eine mehr als das Ergebnis.
    t.zeilen[0].overrides.push({ ...fruehereUebersteuerung, id: "u_bot2", art: "satz", key: "arbeit", wert: 25, rechnerwert: 20 });
    t.rechner.mockClear();

    const r = await sperren("ws", "deal1", 1, MENSCH, {}, t.deps);
    expect(t.rechner).toHaveBeenCalledTimes(1);
    expect(r.version.rechnerRequest).toMatchObject({ satz_arbeit: "25", zeilen_uebersteuerung: [{ key: "halteverbot", betrag: 0 }] });
    expect(vi.mocked(t.speicher.sperrenUndAngebot).mock.calls[0][6]).toMatchObject({ uebersteuerungen: 2 });
  });

  it("Übersteuerung kommt während der Neuberechnung beim Sperren dazu: noch einmal gerechnet, gesperrt mit der aktuellen Liste", async () => {
    const t = aufbau("2026-11-03T09:00:00Z");
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    t.setzeJetzt("2026-11-05T09:00:00Z");
    const original = vi.mocked(t.speicher.aktualisieren).getMockImplementation()!;
    vi.mocked(t.speicher.aktualisieren).mockImplementationOnce(async (id, patch) => {
      t.zeilen[0].overrides.push({ ...fruehereUebersteuerung, id: "u_bot2" });
      return original(id, patch);
    });
    t.rechner.mockClear();
    const r = await sperren("ws", "deal1", 1, MENSCH, {}, t.deps);
    expect(t.rechner).toHaveBeenCalledTimes(2);
    expect(r.version.rechnerRequest?.marge_prozent).toBe("45");
    expect(vi.mocked(t.speicher.sperrenUndAngebot).mock.calls[0][6]).toMatchObject({ uebersteuerungen: 1 });
  });

  it("späte Neuberechnung landet zwischen Frischeprüfung und Sperre: gesperrte Zeile trägt den Stand, aus dem kv_items stammen (I1)", async () => {
    const t = aufbau();
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    await uebersteuern("ws", "deal1", 1, ueberHalteverbot, MENSCH, t.deps);
    const gepreist = structuredClone(t.zeilen[0]);
    const original = vi.mocked(t.speicher.sperrenUndAngebot).getMockImplementation()!;
    vi.mocked(t.speicher.sperrenUndAngebot).mockImplementationOnce(async (...args) => {
      // Ein älterer Lauf schreibt sein Ergebnis noch (status ist entwurf, Anzahl gleich).
      Object.assign(t.zeilen[0], {
        rechnerRequest: { alt: "ja" }, rechnerResult: ergebnis(999), costLines: [], margin: null, inputs: [], referenceDate: "2026-11-04", error: "alt",
      });
      return original(...args);
    });
    const r = await sperren("ws", "deal1", 1, MENSCH, {}, t.deps);
    expect(r.version).toMatchObject({
      status: "gesperrt", priceCents: 149000, referenceDate: "2026-11-05", error: null,
      rechnerRequest: gepreist.rechnerRequest, rechnerResult: gepreist.rechnerResult, costLines: gepreist.costLines,
      margin: gepreist.margin, inputs: gepreist.inputs, tariff: gepreist.tariff, packagePrices: gepreist.packagePrices,
    });
    expect(vi.mocked(t.speicher.sperrenUndAngebot).mock.calls[0][6]?.schnappschuss?.rechnerRequest).toEqual(gepreist.rechnerRequest);
  });

  it("nur das Datum ist alt: neu gerechnet, weil die Eilregel vom Tag abhängt", async () => {
    const t = aufbau("2026-11-03T09:00:00Z");
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    t.setzeJetzt("2026-11-05T09:00:00Z");
    await sperren("ws", "deal1", 1, MENSCH, {}, t.deps);
    expect(t.rechner).toHaveBeenCalledTimes(2);
  });

  it("Kundenannahme: AngebotAngenommenError kommt unverändert heraus, Version bleibt Entwurf (Review Focus 4)", async () => {
    const t = aufbau();
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    const annahme = new AngebotAngenommenError();
    t.deps.pruefeAnnahme.mockRejectedValueOnce(annahme);
    await expect(sperren("ws", "deal1", 1, MENSCH, {}, t.deps)).rejects.toBe(annahme);
    expect(t.speicher.sperrenUndAngebot).not.toHaveBeenCalled();
    expect(t.zeilen[0].status).toBe("entwurf");
  });

  it("Paketoptionen → PAKETE; Stunden-KV beim Agenten oder Stunden-Version → STUNDEN; nichts gesperrt", async () => {
    const t = aufbau();
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    t.deps.hatPakete.mockResolvedValueOnce(true);
    await expect(sperren("ws", "deal1", 1, MENSCH, {}, t.deps)).rejects.toMatchObject({ code: "PAKETE", status: 409 });

    // Ein Agent verwandelt einen Stunden-KV nie still in einen Festpreis.
    t.deps.ladeAngebot.mockResolvedValueOnce(angebot({ isVariable: true }));
    await expect(sperren("ws", "deal1", 1, AGENT, {}, t.deps)).rejects.toMatchObject({ code: "STUNDEN", status: 409 });

    // pricing_mode "stunden" an der Version sperrt niemand, auch kein Mensch.
    t.zeilen[0].pricingMode = "stunden";
    await expect(sperren("ws", "deal1", 1, MENSCH, {}, t.deps)).rejects.toMatchObject({ code: "STUNDEN" });
    expect(t.speicher.sperrenUndAngebot).not.toHaveBeenCalled();
    expect(t.deps.pruefeAnnahme).not.toHaveBeenCalled();
  });

  it("Mensch mit vorhandenem Stunden-KV: stellt wie bisher auf Festpreis um, Notizen bleiben", async () => {
    const t = aufbau();
    t.deps.ladeAngebot.mockResolvedValue(angebot({ isVariable: true, notes: "Klavier" }));
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    const r = await sperren("ws", "deal1", 1, MENSCH, {}, t.deps);
    expect(r.version.status).toBe("gesperrt");
    const eingabe = vi.mocked(t.speicher.sperrenUndAngebot).mock.calls[0][3];
    expect(eingabe).toMatchObject({ fixedPrice: "1490", isVariable: false, notes: "Klavier" });
  });

  it("nur Spanne: ohne Bestätigung SPANNE mit dem heutigen Text, mit Bestätigung die Obergrenze", async () => {
    const t = aufbau();
    t.setzeAntwort({ ok: true, ergebnis: { ...ergebnis(), schaetzung: { festpreisVon: 1200, festpreisBis: 1800, annahmen: [] } } });
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    await expect(sperren("ws", "deal1", 1, MENSCH, {}, t.deps)).rejects.toMatchObject({
      code: "SPANNE", status: 409, message: "Nur eine Spanne vorhanden. Obergrenze übernehmen? (bestaetigtSpanne)",
    });
    const r = await sperren("ws", "deal1", 1, MENSCH, { bestaetigtSpanne: true }, t.deps);
    expect(r.version.priceCents).toBe(180000);
  });

  it("andere Ablehnung der Übernahme (kein Preis) → UNGUELTIG mit ihrem Text", async () => {
    const t = aufbau();
    t.setzeAntwort({ ok: true, ergebnis: { preis: { festpreis: null, nichtKalkulierbarGrund: "Keine Arbeit erfasst" } } });
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    await expect(sperren("ws", "deal1", 1, MENSCH, {}, t.deps)).rejects.toMatchObject({
      code: "UNGUELTIG", status: 400, message: "Kein Preis kalkulierbar: Keine Arbeit erfasst",
    });
  });

  it("gesperrte Version lässt sich nicht noch einmal sperren", async () => {
    const t = aufbau();
    t.lege(1);
    await expect(sperren("ws", "deal1", 1, MENSCH, {}, t.deps)).rejects.toMatchObject({ code: "UNGUELTIG", message: "Version v1 ist bereits gesperrt." });
  });
});

describe("angebotAusVersionSchreiben", () => {
  const eingabe = (): AngebotsEingabe => ({
    fixedPrice: "1490",
    isVariable: false,
    notes: "Klavier",
    calculationAssumptions: { selbstkosten: 800, uebernommenVon: "mensch" } as AngebotsEingabe["calculationAssumptions"],
    lineItems: [
      { type: "other", description: "Umzug", quantity: 1, unitRate: "1340.00", sortOrder: 0 },
      { type: "other", description: "Halteverbotszone", quantity: 1, unitRate: "150.00", sortOrder: 1 },
      { type: "other", description: "Einpacken (inklusive)", quantity: 1, unitRate: "0.00", sortOrder: 2 },
    ],
    documentDetails: { services: { transport: { owner: "company" } }, validUntil: "2026-11-19" },
    validUntil: "2026-11-19",
  });

  function txMock(vorhanden: Record<string, unknown> | null) {
    const log: { update?: Record<string, unknown>; insertQuotation?: Record<string, unknown>; geloescht: number; posten?: Array<Record<string, unknown>> } = { geloescht: 0 };
    const tx = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => (vorhanden ? [vorhanden] : []) }) }) }),
      update: () => ({ set: (s: Record<string, unknown>) => { log.update = s; return { where: async () => undefined }; } }),
      insert: (tabelle: unknown) => ({
        values: (v: unknown) => {
          if (tabelle === quotationLineItems) { log.posten = v as Array<Record<string, unknown>>; return Promise.resolve(); }
          expect(tabelle).toBe(quotations);
          log.insertQuotation = v as Record<string, unknown>;
          return { returning: async () => [{ id: "q_neu" }] };
        },
      }),
      delete: () => ({ where: async () => { log.geloescht += 1; } }),
    };
    return { tx: tx as never, log };
  }

  it("vorhandene Quotation: Festpreis = Cent-Summe, 0-€-Zeile bleibt, Notizen und Kundenfelder unberührt, Version verknüpft", async () => {
    const { tx, log } = txMock({
      id: "q1", notes: "Klavier im Keller", calculationAssumptions: { margeGewaehltProzent: 35, anfahrtMinuten: 10 },
      documentDetails: { reference: "KV-1" },
    });
    await angebotAusVersionSchreiben(tx, "deal1", eingabe(), "id_v3");
    expect(log.update).toMatchObject({ fixedPrice: "1490.00", isVariable: false, validUntil: "2026-11-19", calculationVersionId: "id_v3" });
    expect(log.update).not.toHaveProperty("notes");
    expect(log.update).not.toHaveProperty("summary");
    expect(log.update).not.toHaveProperty("depositRequiredCents");
    expect(log.update).not.toHaveProperty("paymentMethodPreference");
    expect(log.update).not.toHaveProperty("selectedPackageSlug");
    expect(log.update).not.toHaveProperty("selectedPackageOptionId");
    expect(log.update?.documentDetails).toEqual({ reference: "KV-1", services: { transport: { owner: "company" } }, validUntil: "2026-11-19" });
    expect(log.update?.calculationAssumptions).toMatchObject({ selbstkosten: 800, margeGewaehltProzent: 35 });
    expect(log.geloescht).toBe(1);
    expect(log.posten).toHaveLength(3);
    expect(log.posten?.[2]).toMatchObject({ quotationId: "q1", description: "Einpacken (inklusive)", quantity: 1, unitRate: "0.00", type: "other" });
  });

  it("ohne Quotation: neu angelegt mit Notizen aus der Eingabe und Version", async () => {
    const { tx, log } = txMock(null);
    await angebotAusVersionSchreiben(tx, "deal1", eingabe(), "id_v1");
    expect(log.insertQuotation).toMatchObject({ dealRecordId: "deal1", fixedPrice: "1490.00", notes: "Klavier", calculationVersionId: "id_v1" });
    expect(log.posten?.every((p) => p.quotationId === "q_neu")).toBe(true);
  });

  it("Menge nicht ganzzahlig: Fehler vor jedem Schreiben", async () => {
    const { tx, log } = txMock(null);
    const e = eingabe();
    e.lineItems[0].quantity = 1.5;
    await expect(angebotAusVersionSchreiben(tx, "deal1", e, "id_v1")).rejects.toThrow(/ganzzahlig/);
    expect(log.insertQuotation).toBeUndefined();
  });
});

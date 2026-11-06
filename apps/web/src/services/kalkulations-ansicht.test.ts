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

import { anfrageMitUebersteuerungen } from "@/lib/kalkulation-versionen";
import {
  DARIO,
  WEBER_DEAL,
  WEBER_HEUTE,
  WEBER_JETZT,
  WEBER_LEAD,
  weberErgebnis,
  weberFotos,
  weberInventar,
  weberVersion,
} from "@/lib/kalkulations-ansicht.fixture";
import { entwurfVeraltet, type VersionsZeile } from "./kalkulation-versionen";
import { ladeKalkulationsAnsicht, type AnsichtOptionen } from "./kalkulations-ansicht";
import { rechnerAnfrageAus, type LeadDaten } from "./rechner/eingabe";

const basis = (lead: LeadDaten = WEBER_LEAD) => rechnerAnfrageAus(lead);

describe("entwurfVeraltet (Review Focus 3)", () => {
  it("frisch gerechneter Entwurf ist aktuell", () => {
    expect(entwurfVeraltet(weberVersion(), basis(), WEBER_HEUTE, null)).toBe(false);
  });

  it("Lead geändert → veraltet", () => {
    expect(entwurfVeraltet(weberVersion(), basis({ ...WEBER_LEAD, etageVon: 3 }), WEBER_HEUTE, null)).toBe(true);
  });

  it("Bezugsdatum von gestern → veraltet", () => {
    expect(entwurfVeraltet(weberVersion(), basis(), "2026-11-07", null)).toBe(true);
  });

  it("Ergebnis ohne Montage-Echo oder ohne Anfrage → veraltet", () => {
    const { montageJePosition: _echo, ...ohneEcho } = weberErgebnis();
    expect(entwurfVeraltet(weberVersion({ rechnerResult: ohneEcho }), basis(), WEBER_HEUTE, null)).toBe(true);
    expect(entwurfVeraltet(weberVersion({ rechnerRequest: null }), basis(), WEBER_HEUTE, null)).toBe(true);
  });

  it("gesperrte Version ist nie veraltet, auch mit geändertem Lead, altem Datum und ohne Echo", () => {
    const { montageJePosition: _echo, ...ohneEcho } = weberErgebnis();
    const v = weberVersion({ status: "gesperrt", rechnerResult: ohneEcho });
    expect(entwurfVeraltet(v, basis({ ...WEBER_LEAD, kartons: 80 }), "2026-11-20", null)).toBe(false);
  });

  it("Paket-Deal: mit den Paket-Hebeln gerechnet ist nicht fälschlich veraltet, ohne sie schon", () => {
    const hebel = { basis: [], komfort: ["montage" as const, "halteverbot" as const] };
    const v = weberVersion();
    v.rechnerRequest = anfrageMitUebersteuerungen(basis(), v.overrides, { referenceDate: WEBER_HEUTE, paketHebel: hebel });
    expect(entwurfVeraltet(v, basis(), WEBER_HEUTE, hebel)).toBe(false);
    expect(entwurfVeraltet(v, basis(), WEBER_HEUTE, null)).toBe(true);
  });
});

function deps(felder: Partial<AnsichtOptionen> = {}, versionen: VersionsZeile[] = [weberVersion()]) {
  const v1 = weberVersion({
    id: "ver_v1", version: 1, status: "gesperrt", priceCents: 239000,
    sentAt: new Date("2026-11-04T10:40:00.000Z"), lockedAt: new Date("2026-11-04T10:30:00.000Z"), lockedBy: DARIO,
  });
  const alle = [v1, ...versionen];
  const o: Required<AnsichtOptionen> = {
    speicher: {
      lesen: vi.fn(async (_ws: string, _deal: string, n: number) => alle.find((v) => v.version === n) ?? null),
      liste: vi.fn(async () => alle),
    },
    ladeLead: vi.fn(async () => WEBER_LEAD),
    hatPakete: vi.fn(async () => false),
    ladePaketHebel: vi.fn(async () => null),
    ladeInventar: vi.fn(async () => weberInventar()),
    ladeFotos: vi.fn(async () => weberFotos()),
    ladeKopf: vi.fn(async () => ({ name: "Familie Weber", firmaId: "oc_kottke" })),
    ladeVorlagen: vi.fn(async () => [{ id: "zp_1", bezeichnung: "Klavier", minuten: 60 }]),
    ladeAngebot: vi.fn(async () => null),
    ladeKvDokument: vi.fn(async () => null),
    ladeNamen: vi.fn(async (ids: string[]) => Object.fromEntries(ids.filter((id) => id === DARIO).map((id) => [id, "Dario Kottke"]))),
    ladePaketNamen: vi.fn(async () => ({})),
    istKottke: vi.fn(async () => true),
    jetzt: () => WEBER_JETZT,
    ...felder,
  };
  return o;
}

describe("ladeKalkulationsAnsicht", () => {
  it("baut die Ansicht aus Version, Lead, Inventar, Fotos und Firma; Kottke rendert über den VPS", async () => {
    const d = deps();
    const a = await ladeKalkulationsAnsicht("ws_1", WEBER_DEAL, 2, d);
    expect(a.kopf).toMatchObject({
      name: "Familie Weber", strecke: "Stuttgart nach Esslingen", termin: "Sa 21.11.", aktenLink: "/app/leads/deal_weber",
      unterzeile: "Familie Weber, Umzug Stuttgart nach Esslingen, Sa 21.11.",
    });
    expect(a.version).toMatchObject({ nummer: 2, veraltet: false, sperrbar: true, renderer: "vps" });
    expect(a.versionen.map((v) => [v.version, v.aktiv, v.gesendet])).toEqual([[1, false, "Mi 04.11. 11:40"], [2, true, null]]);
    expect(a.marge.gewaehltVon).toBe("Dario");
    expect(a.zeitpostenVorlagen).toEqual([{ id: "zp_1", bezeichnung: "Klavier", minuten: 60 }]);
    expect(a.grundlage.fotosGesamt).toBe(3);
    expect(d.ladeVorlagen).toHaveBeenCalledWith("ws_1", "oc_kottke");
    expect(d.ladeNamen).toHaveBeenCalledWith(expect.arrayContaining([DARIO]));
    expect(d.ladePaketHebel).not.toHaveBeenCalled();
  });

  it("veralteter Entwurf (Lead geändert): veraltet, nicht sperrbar", async () => {
    const a = await ladeKalkulationsAnsicht("ws_1", WEBER_DEAL, 2, deps({ ladeLead: vi.fn(async () => ({ ...WEBER_LEAD, kartons: 80 })) }));
    expect(a.version).toMatchObject({ veraltet: true, sperrbar: false, sperrGrund: "Die Kalkulation ist nicht mehr aktuell. Bitte zuerst neu rechnen." });
  });

  it("gesperrte Version mit KV-Dokument: KV-Dokument der Version, nie veraltet", async () => {
    const d = deps({ ladeKvDokument: vi.fn(async () => ({ id: "doc_1", fileName: "KV-Weber.pdf" })) });
    const a = await ladeKalkulationsAnsicht("ws_1", WEBER_DEAL, 1, d);
    expect(a.version).toMatchObject({ status: "gesperrt", veraltet: false, kvDokument: { id: "doc_1", fileName: "KV-Weber.pdf" } });
    expect(d.ladeKvDokument).toHaveBeenCalledWith("ws_1", WEBER_DEAL, "ver_v1");
  });

  it("Paket-Deal: Hebel der Pakete für die Frische, Paketnamen, Sperren abgelehnt", async () => {
    const hebel = { basis: [] };
    const v = weberVersion({ packagePrices: [{ slug: "basis", festpreis: 1990, selbstkosten: 1300 }] });
    v.rechnerRequest = anfrageMitUebersteuerungen(rechnerAnfrageAus(WEBER_LEAD), v.overrides, { referenceDate: WEBER_HEUTE, paketHebel: hebel });
    const d = deps(
      { hatPakete: vi.fn(async () => true), ladePaketHebel: vi.fn(async () => hebel), ladePaketNamen: vi.fn(async () => ({ basis: "Basis" })) },
      [v]
    );
    const a = await ladeKalkulationsAnsicht("ws_1", WEBER_DEAL, 2, d);
    expect(a.version).toMatchObject({ veraltet: false, sperrbar: false, sperrGrund: "Sperren mit Paketpreisen kommt später. Bis dahin den Preis über die Paketpreise pflegen." });
    expect(a.pakete).toEqual([{ slug: "basis", name: "Basis", preisCent: 199000, hinweis: null }]);
  });

  it("ohne Firma keine Zeitposten-Vorlagen; Nicht-Kottke rendert im CRM", async () => {
    const d = deps({ ladeKopf: vi.fn(async () => ({ name: null, firmaId: null })), istKottke: vi.fn(async () => false) });
    const a = await ladeKalkulationsAnsicht("ws_1", WEBER_DEAL, 2, d);
    expect(a.zeitpostenVorlagen).toEqual([]);
    expect(d.ladeVorlagen).not.toHaveBeenCalled();
    expect(a.kopf.name).toBe("Ohne Namen");
    expect(a.version.renderer).toBe("crm");
  });

  it("unbekannte Version oder unbekannter Deal → NICHT_GEFUNDEN", async () => {
    await expect(ladeKalkulationsAnsicht("ws_1", WEBER_DEAL, 9, deps())).rejects.toMatchObject({
      code: "NICHT_GEFUNDEN", status: 404, message: "Version v9 nicht gefunden.",
    });
    await expect(ladeKalkulationsAnsicht("ws_1", WEBER_DEAL, 2, deps({ ladeLead: vi.fn(async () => null) }))).rejects.toMatchObject({
      code: "NICHT_GEFUNDEN", message: "Deal nicht gefunden.",
    });
  });
});

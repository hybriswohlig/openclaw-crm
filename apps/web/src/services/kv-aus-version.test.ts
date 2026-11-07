import { beforeEach, describe, expect, it, vi } from "vitest";

// Kein Zugriff auf die Datenbank: jeder Zugriff auf `db` lässt den Test scheitern.
vi.mock("@/db", () => ({
  db: new Proxy({}, { get(_t, p) { if (p === "then" || typeof p === "symbol") return undefined; throw new Error(`@/db im Test (${String(p)})`); } }),
}));

import { VersionsFehler, type VersionsZeile } from "./kalkulation-versionen";
import { kvAusVersion, type KvAusVersionOptionen } from "./kv-aus-version";

const version = (over: Partial<VersionsZeile> = {}) =>
  ({ id: "ver_2", workspaceId: "ws_1", dealRecordId: "deal_1", version: 2, status: "gesperrt", ...over }) as VersionsZeile;

const DOKUMENT = {
  id: "doc_1",
  documentType: "quotation" as const,
  fileName: "KV-CE-20261106-WEB-ab12cd34.pdf",
  fileSize: 4,
  mimeType: "application/pdf",
  uploadedAt: new Date("2026-11-06T10:00:00.000Z"),
};

const m = {
  ladeVersion: vi.fn(),
  ladeVersionen: vi.fn(),
  ladeAngebotsVersionId: vi.fn(),
  istKottke: vi.fn(),
  hatPakete: vi.fn(),
  speichereKv: vi.fn(),
  ladeSchalter: vi.fn(),
  ladeAngebot: vi.fn(),
  ladeWahl: vi.fn(),
};
// Ein Lader für Angebot und Wahl (N4); die Tests setzen beide Teile einzeln.
const opt = {
  ...m,
  ladeAngebotUndWahl: async (deal: string, v: Parameters<NonNullable<KvAusVersionOptionen["ladeAngebotUndWahl"]>>[1]) => ({
    angebot: await m.ladeAngebot(deal),
    wahl: await m.ladeWahl(deal, v),
  }),
} as unknown as KvAusVersionOptionen;
const eingabe = { workspaceId: "ws_1", dealRecordId: "deal_1", version: 2, updatedBy: "usr_1" };

beforeEach(() => {
  vi.clearAllMocks();
  m.ladeVersion.mockResolvedValue(version());
  m.ladeVersionen.mockResolvedValue([{ version: 1, status: "gesperrt" }, { version: 2, status: "gesperrt" }]);
  m.ladeAngebotsVersionId.mockResolvedValue("ver_2");
  m.istKottke.mockResolvedValue(false);
  m.hatPakete.mockResolvedValue(false);
  m.ladeSchalter.mockResolvedValue({ angebotAusKalkulation: false, tagespreise: false });
  m.ladeAngebot.mockResolvedValue(null);
  m.ladeWahl.mockResolvedValue({ paketSlug: null, datum: null });
  m.speichereKv.mockResolvedValue({ document: DOKUMENT, fileName: DOKUMENT.fileName, templateVersion: "t", rechnungFaelligAm: null });
});

async function fehlerVon(p: Promise<unknown>): Promise<VersionsFehler> {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(VersionsFehler);
  return err as VersionsFehler;
}

describe("kvAusVersion", () => {
  it("Deal mit Paketoptionen → PAKETE, kein PDF, auch für Kottke kein Hinweis", async () => {
    m.hatPakete.mockResolvedValue(true);
    m.istKottke.mockResolvedValue(true);
    const err = await fehlerVon(kvAusVersion(eingabe, opt));
    expect(err.code).toBe("PAKETE");
    expect(err.status).toBe(409);
    expect(err.message).toBe("Sperren mit Paketpreisen kommt später. Bis dahin den Preis über die Paketpreise pflegen.");
    expect(m.speichereKv).not.toHaveBeenCalled();
  });

  it("Kottke → renderer vps mit Hinweis, kein CRM-PDF (Review Focus 5)", async () => {
    m.istKottke.mockResolvedValue(true);
    const r = await kvAusVersion(eingabe, opt);
    expect(r).toEqual({
      renderer: "vps",
      hinweis: "Kottke-KV über „Dokument erzeugen“ erstellen; die Preise kommen aus Version v2.",
    });
    expect(m.speichereKv).not.toHaveBeenCalled();
    expect(m.istKottke).toHaveBeenCalledWith("ws_1", "deal_1");
  });

  it("Nicht-Kottke → storeCommercialDocument mit kind KV, notifyCustomer false", async () => {
    const r = await kvAusVersion(eingabe, opt);
    expect(r).toEqual({ renderer: "crm", document: DOKUMENT, fileName: DOKUMENT.fileName });
    expect(m.speichereKv).toHaveBeenCalledTimes(1);
    expect(m.speichereKv).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      dealRecordId: "deal_1",
      kind: "KV",
      copy: {},
      notifyCustomer: false,
      updatedBy: "usr_1",
      pruefeVersion: expect.any(Function),
    });
    expect(m.ladeVersion).toHaveBeenCalledWith("ws_1", "deal_1", 2);
    expect(m.ladeAngebotsVersionId).toHaveBeenCalledWith("deal_1");
  });

  it("Texte laufen durch ohnePreisangaben; leerer Rest fällt weg", async () => {
    await kvAusVersion(
      {
        ...eingabe,
        copy: {
          intro: "Gern bieten wir an. Der Preis beträgt 1.250 €. Wir freuen uns.",
          closing: "Gesamt 990 EUR.",
          remarks: "Es kommen 3 Helfer.",
        },
      },
      opt
    );
    expect(m.speichereKv.mock.calls[0][0].copy).toEqual({
      intro: "Gern bieten wir an. Wir freuen uns.",
      remarks: "Es kommen 3 Helfer.",
    });
  });

  it("Entwurf → UNGUELTIG, nichts gerendert", async () => {
    m.ladeVersion.mockResolvedValue(version({ status: "entwurf" }));
    const err = await fehlerVon(kvAusVersion(eingabe, opt));
    expect(err.code).toBe("UNGUELTIG");
    expect(err.status).toBe(400);
    expect(err.message).toBe("Version v2 ist nicht gesperrt.");
    expect(m.speichereKv).not.toHaveBeenCalled();
  });

  it("Entwurf bei Kottke → ebenfalls UNGUELTIG, kein Hinweis", async () => {
    m.istKottke.mockResolvedValue(true);
    m.ladeVersion.mockResolvedValue(version({ status: "entwurf" }));
    expect((await fehlerVon(kvAusVersion(eingabe, opt))).code).toBe("UNGUELTIG");
  });

  it.each([["ver_3"], [null]])("Quotation zeigt auf %s statt auf v2 → UNGUELTIG", async (id) => {
    m.ladeAngebotsVersionId.mockResolvedValue(id);
    const err = await fehlerVon(kvAusVersion(eingabe, opt));
    expect(err.code).toBe("UNGUELTIG");
    expect(err.message).toBe("Das Angebot wurde nach v2 von Hand geändert. Neue Version sperren.");
    expect(m.speichereKv).not.toHaveBeenCalled();
  });

  it("neuere gesperrte Version → UNGUELTIG „nicht mehr aktuell“ mit deren Nummer", async () => {
    m.ladeAngebotsVersionId.mockResolvedValue("ver_3");
    m.ladeVersionen.mockResolvedValue([
      { version: 1, status: "gesperrt" },
      { version: 2, status: "gesperrt" },
      { version: 3, status: "gesperrt" },
      { version: 4, status: "entwurf" },
    ]);
    const err = await fehlerVon(kvAusVersion(eingabe, opt));
    expect(err.code).toBe("UNGUELTIG");
    expect(err.message).toBe("Version v2 ist nicht mehr aktuell, aktuell ist v3.");
    expect(m.ladeVersionen).toHaveBeenCalledWith("ws_1", "deal_1");
    expect(m.speichereKv).not.toHaveBeenCalled();
  });

  it("nur ein neuerer Entwurf → Text der Handänderung", async () => {
    m.ladeAngebotsVersionId.mockResolvedValue(null);
    m.ladeVersionen.mockResolvedValue([{ version: 2, status: "gesperrt" }, { version: 3, status: "entwurf" }]);
    const err = await fehlerVon(kvAusVersion(eingabe, opt));
    expect(err.message).toBe("Das Angebot wurde nach v2 von Hand geändert. Neue Version sperren.");
  });

  it("passt die Quotation, werden die Versionen nicht gelesen", async () => {
    await kvAusVersion(eingabe, opt);
    expect(m.ladeVersionen).not.toHaveBeenCalled();
  });

  describe("gerenderte Quotation zeigt auf eine andere Version (Review 4)", () => {
    /** Renderer wie storeCommercialDocument: rendert, prüft die Version, speichert nur danach. */
    function rendertMit(gerendert: string | null) {
      const gespeichert = vi.fn();
      m.speichereKv.mockImplementation(async (arg: { pruefeVersion?: (id: string | null) => Promise<void> }) => {
        await arg.pruefeVersion?.(gerendert);
        gespeichert();
        return { document: DOKUMENT, fileName: DOKUMENT.fileName, templateVersion: "t", rechnungFaelligAm: null };
      });
      return gespeichert;
    }

    it("zwischen Prüfung und Rendern v3 gesperrt → „nicht mehr aktuell“, nichts gespeichert", async () => {
      const gespeichert = rendertMit("ver_3");
      m.ladeVersionen.mockResolvedValue([{ version: 2, status: "gesperrt" }, { version: 3, status: "gesperrt" }]);
      const err = await fehlerVon(kvAusVersion(eingabe, opt));
      expect(err.message).toBe("Version v2 ist nicht mehr aktuell, aktuell ist v3.");
      expect(gespeichert).not.toHaveBeenCalled();
    });

    it("zwischen Prüfung und Rendern von Hand geändert (keine Version) → Text der Handänderung, nichts gespeichert", async () => {
      const gespeichert = rendertMit(null);
      const err = await fehlerVon(kvAusVersion(eingabe, opt));
      expect(err.message).toBe("Das Angebot wurde nach v2 von Hand geändert. Neue Version sperren.");
      expect(gespeichert).not.toHaveBeenCalled();
    });

    it("gerendert aus genau dieser Version → gespeichert", async () => {
      const gespeichert = rendertMit("ver_2");
      await expect(kvAusVersion(eingabe, opt)).resolves.toMatchObject({ renderer: "crm" });
      expect(gespeichert).toHaveBeenCalledTimes(1);
    });
  });

  it("Version fehlt → NICHT_GEFUNDEN", async () => {
    m.ladeVersion.mockResolvedValue(null);
    const err = await fehlerVon(kvAusVersion({ ...eingabe, version: 9 }, opt));
    expect(err.code).toBe("NICHT_GEFUNDEN");
    expect(err.message).toBe("Version v9 nicht gefunden.");
  });
});

describe("kvAusVersion mit Firmen-Schalter (Plan 5b)", () => {
  const paketVersion = () =>
    version({
      pricingMode: "fest", priceCents: 149000, kvItems: [{ description: "Komfort", quantity: 1, unitRate: 1490 }],
      packagePrices: [
        { slug: "basis", festpreis: 1290, selbstkosten: 700, kvItems: [{ description: "Basis", quantity: 1, unitRate: 1290 }] },
        { slug: "komfort", festpreis: 1490, selbstkosten: 800, kvItems: [{ description: "Komfort", quantity: 1, unitRate: 1490 }] },
      ],
      dayPrices: [],
    });
  beforeEach(() => {
    m.ladeSchalter.mockResolvedValue({ angebotAusKalkulation: true, tagespreise: false });
    m.hatPakete.mockResolvedValue(true);
    m.ladeVersion.mockResolvedValue(paketVersion());
  });

  it("Paketoptionen: kein PAKETE mehr; die Kundenwahl (Basis) ist eine Wahl der Version → KV wird erstellt", async () => {
    m.ladeWahl.mockResolvedValue({ paketSlug: "basis", datum: null });
    m.ladeAngebot.mockResolvedValue({ fixedPrice: "1290.00", isVariable: false, lineItems: [{ description: "Basis", quantity: 1, unitRate: "1290.00" }] });
    expect(await kvAusVersion(eingabe, opt)).toMatchObject({ renderer: "crm" });
    expect(m.hatPakete).not.toHaveBeenCalled();
    expect(m.ladeWahl).toHaveBeenCalledWith("deal_1", expect.objectContaining({ id: "ver_2" }));
  });

  it("F2 (I1): Preis und Posten einer anderen Wahl (Basis, der Kunde hat Komfort) → Handänderung, kein PDF", async () => {
    m.ladeWahl.mockResolvedValue({ paketSlug: "komfort", datum: null });
    m.ladeAngebot.mockResolvedValue({ fixedPrice: "1290.00", isVariable: false, lineItems: [{ description: "Basis", quantity: 1, unitRate: "1290.00" }] });
    m.ladeVersionen.mockResolvedValue([{ version: 2, status: "gesperrt" }]);
    const err = await fehlerVon(kvAusVersion(eingabe, opt));
    expect(err.message).toBe("Das Angebot wurde nach v2 von Hand geändert. Neue Version sperren.");
    expect(m.speichereKv).not.toHaveBeenCalled();
  });

  it("F2 (I1): geänderter Postentext bei gleichen Beträgen → Handänderung, kein PDF", async () => {
    m.ladeWahl.mockResolvedValue({ paketSlug: "basis", datum: null });
    m.ladeAngebot.mockResolvedValue({ fixedPrice: "1290.00", isVariable: false, lineItems: [{ description: "Basis inkl. Klavier", quantity: 1, unitRate: "1290.00" }] });
    m.ladeVersionen.mockResolvedValue([{ version: 2, status: "gesperrt" }]);
    const err = await fehlerVon(kvAusVersion(eingabe, opt));
    expect(err.message).toBe("Das Angebot wurde nach v2 von Hand geändert. Neue Version sperren.");
  });

  it("Preis von Hand (keine Wahl der Version) → Text der Handänderung, kein PDF", async () => {
    m.ladeAngebot.mockResolvedValue({ fixedPrice: "1350.00", isVariable: false, lineItems: [{ description: "Basis", quantity: 1, unitRate: "1350.00" }] });
    m.ladeVersionen.mockResolvedValue([{ version: 2, status: "gesperrt" }]);
    const err = await fehlerVon(kvAusVersion(eingabe, opt));
    expect(err.message).toBe("Das Angebot wurde nach v2 von Hand geändert. Neue Version sperren.");
    expect(m.speichereKv).not.toHaveBeenCalled();
  });
});

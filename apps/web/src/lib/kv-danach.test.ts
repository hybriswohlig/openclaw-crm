import { describe, expect, it } from "vitest";
import {
  kvChatUrl,
  kvFertigNachricht,
  kvPreisAus,
  paketeZeile,
  statusLinkAusGet,
  statusLinkAusPost,
  statusLinkMeldung,
  tagespreiseZeile,
  type PaketeZeileEingabe,
} from "./kv-danach";

const URL_ = "https://portal.example/s/abc";

describe("Statuslink", () => {
  it("nimmt einen bestehenden Link und legt nur bei KEIN_LINK an", () => {
    expect(statusLinkAusGet({ ok: true, data: { url: URL_, dealNumber: "2026-003", revokedAt: null } })).toEqual({
      art: "ok",
      url: URL_,
      dealNumber: "2026-003",
      neu: false,
    });
    expect(statusLinkAusGet({ ok: false, status: 404, code: "KEIN_LINK", message: "No customer link" })).toBe("anlegen");
    // 404 für den Deal selbst (fremder Workspace, gelöscht): nie anlegen.
    expect(statusLinkAusGet({ ok: false, status: 404, code: "NOT_FOUND", message: "Deal nicht gefunden." })).toEqual({
      art: "fehler",
      text: "Deal nicht gefunden.",
    });
    expect(statusLinkAusGet({ ok: false, status: 500, message: "kaputt" })).toEqual({ art: "fehler", text: "kaputt" });
  });

  it("entsperrt nie still: gesperrt bleibt gesperrt", () => {
    expect(statusLinkAusGet({ ok: true, data: { url: URL_, revokedAt: "2026-11-01T10:00:00Z" } })).toEqual({ art: "gesperrt" });
    expect(statusLinkMeldung({ art: "gesperrt" }).text).toContain("alten Akte");
  });

  it("wertet das Anlegen aus: Portal aus oder neuer Link", () => {
    expect(statusLinkAusPost({ ok: true, data: { url: null, skipped: true } })).toEqual({ art: "portal_aus" });
    expect(statusLinkAusPost({ ok: true, data: { url: URL_, dealNumber: null } })).toEqual({
      art: "ok",
      url: URL_,
      dealNumber: null,
      neu: true,
    });
    expect(statusLinkAusPost({ ok: false, status: 0, message: "Keine Verbindung zum Server." }).art).toBe("fehler");
  });
});

describe("Kurztext nach dem KV", () => {
  it("liest den Preis aus Angebot und Paketoptionen", () => {
    expect(kvPreisAus({ fixedPrice: "2480.00", isVariable: false })).toEqual({ art: "fest", cent: 248000 });
    expect(kvPreisAus({ fixedPrice: null, isVariable: true })).toEqual({ art: "stunden" });
    expect(kvPreisAus({ fixedPrice: "", isVariable: false })).toEqual({ art: "offen" });
    expect(kvPreisAus(null)).toEqual({ art: "offen" });
    // Paketoptionen wie im Portal schlagen den Festpreis; eine einzelne Option nicht.
    expect(kvPreisAus({ fixedPrice: "2480", isVariable: false }, [{ priceCents: 249000 }, { priceCents: 199050 }, { priceCents: 329000 }])).toEqual({
      art: "pakete",
      abCent: 199050,
      anzahl: 3,
    });
    expect(kvPreisAus({ fixedPrice: "2480", isVariable: false }, [{ priceCents: 249000 }])).toEqual({ art: "fest", cent: 248000 });
    // Stunden-KV schlägt Paketoptionen (Review I1): kein Paket-Festpreis an den Kunden.
    expect(kvPreisAus({ fixedPrice: null, isVariable: true }, [{ priceCents: 199000 }, { priceCents: 249000 }])).toEqual({ art: "stunden" });
    // Nur Optionen der Version, an der die Quotation hängt; alte Zeilen zählen nicht.
    const alt = [{ priceCents: 150000, calculationVersionId: "v1" }, { priceCents: 160000, calculationVersionId: "v1" }];
    expect(kvPreisAus({ fixedPrice: "2480", isVariable: false, calculationVersionId: "v2" }, alt)).toEqual({ art: "fest", cent: 248000 });
    expect(
      kvPreisAus({ fixedPrice: "2480", isVariable: false, calculationVersionId: "v2" }, [
        ...alt,
        { priceCents: 230000, calculationVersionId: "v2" },
        { priceCents: 270000, calculationVersionId: "v2" },
      ])
    ).toEqual({ art: "pakete", abCent: 230000, anzahl: 2 });
  });

  it("nennt bei Tagespreisen „ab“, nie einen Einzelpreis (Review M2)", () => {
    const q = { fixedPrice: "2480", isVariable: false, calculationVersionId: "v2" };
    const tage = [
      { priceCents: 248000, calculationVersionId: "v2" },
      { priceCents: 219000, calculationVersionId: "v2" },
      { priceCents: 100000, calculationVersionId: "v1" },
    ];
    expect(kvPreisAus(q, [], tage)).toEqual({ art: "termine", abCent: 219000, mitPaketen: false });
    // Mit Paketen: je Tag die Paketpreise der angebotenen Pakete.
    const optionen = [
      { priceCents: 230000, catalogueSlug: "basis", calculationVersionId: "v2" },
      { priceCents: 280000, catalogueSlug: "komfort", calculationVersionId: "v2" },
    ];
    const tageP = [
      { priceCents: 230000, packagePrices: { basis: 230000, komfort: 280000 }, calculationVersionId: "v2" },
      { priceCents: 210000, packagePrices: { basis: 210000, komfort: 260000 }, calculationVersionId: "v2" },
    ];
    expect(kvPreisAus(q, optionen, tageP)).toEqual({ art: "termine", abCent: 210000, mitPaketen: true });
    // Ein einziger Tagespreis ist der Festpreis.
    expect(kvPreisAus(q, [], [{ priceCents: 250000, calculationVersionId: "v2" }])).toEqual({ art: "fest", cent: 250000 });
    const text = kvFertigNachricht({ firma: "Ceylan", vorname: null, preis: { art: "termine", abCent: 219000, mitPaketen: false }, url: URL_ });
    expect(text).toContain("Der Festpreis hängt vom Termin ab und beginnt bei 2.190 €");
    const du = kvFertigNachricht({ firma: "Kottke", vorname: null, preis: { art: "termine", abCent: 210000, mitPaketen: true }, url: URL_ });
    expect(du).toContain("Je nach Paket und Termin beginnt der Festpreis bei 2.100 €, du wählst im Angebot.");
  });

  it("Kottke duzt, Ceylan bleibt beim Sie", () => {
    const kottke = kvFertigNachricht({
      firma: "Kottke Entrümpelung & Umzüge",
      vorname: "Max",
      preis: { art: "fest", cent: 248000 },
      url: URL_,
      dealNumber: "2026-003",
    });
    expect(kottke).toBe(
      "Hallo Max,\n\ndein Angebot (Auftrag 2026-003) ist fertig. Der Festpreis liegt bei 2.480 €.\n\n" +
        `Alle Details siehst du hier, dort kannst du das Angebot auch direkt annehmen:\n${URL_}\n\n` +
        "Gib mir gern kurz Bescheid, ob alles passt oder ob du noch Fragen hast.\n\nViele Grüße\nKottke Entrümpelung & Umzüge"
    );
    expect(kottke).not.toMatch(/\b(Sie|Ihnen|Ihr)\b/);

    const ceylan = kvFertigNachricht({ firma: "Ceylan Umzüge", vorname: null, preis: { art: "stunden" }, url: URL_ });
    expect(ceylan.startsWith("Hallo,\n\nIhr Angebot ist fertig. Abgerechnet wird nach Aufwand")).toBe(true);
    expect(ceylan).toContain("können Sie das Angebot auch direkt annehmen");
    expect(ceylan).toContain("Geben Sie mir gern kurz Bescheid");
    expect(ceylan).not.toMatch(/\b(du|dein|dir)\b/);
  });

  it("nennt Pakete, lässt einen unbekannten Preis weg und hat keine Gedankenstriche", () => {
    const pakete = kvFertigNachricht({ firma: "Kottke", vorname: "Eva", preis: { art: "pakete", abCent: 199050, anzahl: 3 }, url: URL_ });
    expect(pakete).toContain("dein Angebot ist fertig. Du kannst zwischen 3 Paketen wählen, ab 1.990,50 € zum Festpreis.");
    expect(kvFertigNachricht({ firma: "Ceylan", vorname: null, preis: { art: "pakete", abCent: 100000, anzahl: 2 }, url: URL_ })).toContain(
      "Sie können zwischen 2 Paketen wählen, ab 1.000 € zum Festpreis."
    );
    const offen = kvFertigNachricht({ firma: null, vorname: null, preis: { art: "offen" }, url: URL_ });
    expect(offen).not.toContain("Festpreis");
    expect(offen.endsWith("Viele Grüße")).toBe(true);
    for (const text of [pakete, offen]) expect(text).not.toMatch(/[–—]/);
  });

  it("führt in die Inbox des Deals mit dem Auftrag, den Text vorzubereiten", () => {
    expect(kvChatUrl("deal_1")).toBe("/app/inbox?e=deal%3Adeal_1&kv=1");
  });
});

describe("Pakete-Zeile im KV-Fenster", () => {
  const basis: PaketeZeileEingabe = {
    schalter: { firma: true, deal: null, wirksam: true, pakete: { aktiv: 3, basis: true } },
    tagespreise: true,
    preisModus: "fest",
    pakete: [{ name: "Basis" }, { name: "Komfort" }, { name: "Premium" }],
    tage: 0,
    gesperrt: false,
  };

  it("sagt klar, dass Pakete angeboten werden, mit Schalter zum Ausschalten", () => {
    const z = paketeZeile(basis);
    expect(z.text).toBe("Pakete: werden angeboten (Basis, Komfort, Premium)");
    expect(z.grund).toBeNull();
    expect(z.schalter).toEqual({ an: true, wert: "aus" });
  });

  it("nennt den Grund, wenn keine Pakete angeboten werden", () => {
    const aus = paketeZeile({ ...basis, pakete: [], schalter: { ...basis.schalter!, deal: "aus", wirksam: false } });
    expect(aus.text).toBe("Pakete: nicht angeboten");
    expect(aus.grund).toBe("Für diesen Deal ausgeschaltet.");
    expect(aus.schalter).toEqual({ an: false, wert: "standard" });

    const firmaAus = paketeZeile({ ...basis, pakete: [], schalter: { firma: false, deal: null, wirksam: false, pakete: { aktiv: 3, basis: true } } });
    expect(firmaAus.grund).toBe("Firmen-Schalter „Angebot aus Kalkulation“ ist aus.");
    expect(firmaAus.schalter).toBeNull();
    expect(firmaAus.einstellungen).toEqual({ href: "/app/einstellungen#einst-firmen", text: "Einstellungen, Kundenportal" });

    const ohneBasis = paketeZeile({ ...basis, pakete: [], schalter: { ...basis.schalter!, pakete: { aktiv: 2, basis: false } } });
    expect(ohneBasis.grund).toBe("Die Firma hat kein Basis-Paket.");
    expect(ohneBasis.einstellungen?.href).toBe("/settings/customer-portal");

    const stunden = paketeZeile({ ...basis, preisModus: "stunden" });
    expect(stunden.text).toBe("Pakete: nicht angeboten");
    expect(stunden.grund).toBe("Stunden-KV: Pakete gibt es nur beim Festpreis.");
    expect(stunden.schalter).toBeNull();
  });

  it("schaltet bei Firma aus nur zurück auf den Firmenstandard, ein Deal-An bleibt ausschaltbar", () => {
    const z = paketeZeile({ ...basis, schalter: { firma: false, deal: "an", wirksam: true, pakete: { aktiv: 3, basis: true } } });
    expect(z.schalter).toEqual({ an: true, wert: "standard" });
  });

  it("an einer gesperrten Version kein Schalter, nur der Hinweis auf eine neue Version", () => {
    const z = paketeZeile({ ...basis, gesperrt: true });
    expect(z.schalter).toBeNull();
    expect(z.gesperrtHinweis).toContain("neue Version");
    expect(paketeZeile({ ...basis, gesperrt: true, pakete: [] }).grund).toBe("Diese Version wurde ohne Pakete gesperrt.");
  });

  it("zeigt die Tagespreise als Hinweiszeile", () => {
    expect(tagespreiseZeile({ tagespreise: false, preisModus: "fest", tage: 0 })).toBe("Tagespreise: für diese Firma aus.");
    expect(tagespreiseZeile({ tagespreise: true, preisModus: "stunden", tage: 2 })).toBe("Tagespreise: beim Stunden-KV nicht.");
    expect(tagespreiseZeile({ tagespreise: true, preisModus: "fest", tage: 1 })).toBe("Tagespreise: 1 Tag im Angebot.");
    expect(tagespreiseZeile({ tagespreise: true, preisModus: "fest", tage: 3 })).toBe("Tagespreise: 3 Tage im Angebot.");
    expect(tagespreiseZeile({ tagespreise: true, preisModus: "fest", tage: 0 })).toContain("Termin-Dialog");
  });
});

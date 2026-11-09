import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COOKIE_MAX_ALTER_S,
  DARSTELLUNG_COOKIE,
  FILL_DECKEND,
  KUERZEL_FARBEN,
  NIE_UMLEITEN,
  TEXT_TOKENS,
  TOKENS,
  ZUORDNUNG,
  cookieWert,
  cookieZeile,
  darstellungLesen,
  farbeLesen,
  harteFarben,
  istNeuPfad,
  kontrast,
  minKontrast,
  themeAus,
  ueber,
  umleitZiel,
  DETAILS_TEXT_MAX,
  NACH_ANNAHME_ERLAUBT,
  QUOTATION_GESPERRT,
  RUHE_TAGE,
  SERVICE_TYPES,
  ZAEHL_MIN_TAGE,
  quotationDetailsPruefen,
  quotationPutErlaubt,
  quotationQuelle,
  quotationStufe,
  sperreBereit,
  type QuotationQuelle,
} from "./dunkel-abschaltung";

// ─── 1. Darstellung ─────────────────────────────────────────────────────────

describe("1. Darstellung", () => {
  it("liest nur die drei gültigen Werte", () => {
    expect(darstellungLesen("hell")).toBe("hell");
    expect(darstellungLesen("dunkel")).toBe("dunkel");
    expect(darstellungLesen("system")).toBe("system");
    for (const roh of [null, undefined, "", "dark", "Hell", " hell"]) expect(darstellungLesen(roh)).toBeNull();
  });

  it("leitet das Theme ab; ohne Wert folgt es dem Gerät", () => {
    expect(themeAus("hell", true)).toBe("light");
    expect(themeAus("dunkel", false)).toBe("dark");
    expect(themeAus("system", true)).toBe("dark");
    expect(themeAus("system", false)).toBe("light");
    expect(themeAus(null, true)).toBe("dark");
    expect(themeAus(null, false)).toBe("light");
  });

  it("kennt nur /app und Unterpfade als neue Oberfläche", () => {
    expect(istNeuPfad("/app")).toBe(true);
    expect(istNeuPfad("/app/heute")).toBe(true);
    expect(istNeuPfad("/apple")).toBe(false);
    expect(istNeuPfad("/s/abc")).toBe(false);
    expect(istNeuPfad("/home")).toBe(false);
  });

  it("baut die Cookie-Zeile mit Pfad, Alter und SameSite", () => {
    expect(cookieZeile(DARSTELLUNG_COOKIE, "dunkel", false)).toBe(
      `neu_darstellung=dunkel; Path=/; Max-Age=${COOKIE_MAX_ALTER_S}; SameSite=Lax`
    );
    expect(cookieZeile("x", "a b", true)).toMatch(/^x=a%20b; .*; Secure$/);
  });

  it("liest einen Cookie-Wert und verträgt kaputte Kodierung", () => {
    expect(cookieWert("a=1; neu_darstellung=hell; b=2", DARSTELLUNG_COOKIE)).toBe("hell");
    expect(cookieWert("neu_darstellung=a%3Db", DARSTELLUNG_COOKIE)).toBe("a=b");
    expect(cookieWert("x=1", DARSTELLUNG_COOKIE)).toBeNull();
    expect(cookieWert("neu_darstellung=%E0%A4%A", DARSTELLUNG_COOKIE)).toBeNull();
  });
});

// ─── 2. Tokens ──────────────────────────────────────────────────────────────

describe("2. Tokens", () => {
  it("hat für jedes Token einen lesbaren Hell- und Dunkelwert", () => {
    for (const [name, { hell, dunkel }] of Object.entries(TOKENS)) {
      expect(farbeLesen(hell), `${name} hell`).not.toBeNull();
      expect(farbeLesen(dunkel), `${name} dunkel`).not.toBeNull();
    }
  });

  it("deckt alle Text-Tokens ab und nutzt Anthrazit als Seitenende", () => {
    for (const t of TEXT_TOKENS) expect(TOKENS[t], t).toBeDefined();
    expect(TOKENS["--seite-unten"].dunkel).toBe("#1c1c1e");
    expect(FILL_DECKEND).toEqual({ light: "#ffffff", dark: "#2c2c2e" });
  });

  it("beginnt die Kürzel-Farben mit der dunklen Fläche statt mit --ink", () => {
    expect(KUERZEL_FARBEN[0]).toBe("var(--tinte-flaeche)");
    expect(new Set(KUERZEL_FARBEN).size).toBe(KUERZEL_FARBEN.length);
  });
});

// ─── 3. Kontrast ────────────────────────────────────────────────────────────

describe("3. Kontrast", () => {
  it("liest Hex, rgb und rgba", () => {
    expect(farbeLesen("#ff0080")).toEqual({ r: 255, g: 0, b: 128, a: 1 });
    expect(farbeLesen("rgba(44, 44, 46, 0.52)")).toEqual({ r: 44, g: 44, b: 46, a: 0.52 });
    expect(farbeLesen("rgb(0 0 0 / 0.5)")).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(farbeLesen("#fff")).toBeNull();
    expect(farbeLesen("var(--ink)")).toBeNull();
  });

  it("legt Farben übereinander", () => {
    expect(ueber("#000000", "#ffffff")).toBe("#000000");
    expect(ueber("rgba(0, 0, 0, 0)", "#ffffff")).toBe("#ffffff");
    expect(ueber("rgba(0, 0, 0, 0.5)", "#ffffff")).toBe("#808080");
    expect(ueber("rgba(255, 255, 255, 0.52)", "#faf9f7")).toBe("#fdfcfb");
    expect(() => ueber("var(--x)", "#ffffff")).toThrow(/nicht lesbar/);
  });

  it("rechnet den WCAG-Kontrast", () => {
    expect(kontrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(kontrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(kontrast("#777777", "#777777")).toBeCloseTo(1, 5);
    expect(kontrast("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });

  it.each(TEXT_TOKENS.flatMap((t) => (["hell", "dunkel"] as const).map((theme) => [t, theme] as const)))(
    "%s hält im Theme %s auf jeder Fläche 4,5:1",
    (t, theme) => {
      expect(minKontrast(t, theme)).toBeGreaterThanOrEqual(4.5);
    }
  );

  it("liegt in den Spannen der Probe (hell 5,2 bis 14,4, dunkel 6,4 bis 12,8)", () => {
    const hell = TEXT_TOKENS.map((t) => minKontrast(t, "hell"));
    const dunkel = TEXT_TOKENS.map((t) => minKontrast(t, "dunkel"));
    expect(Math.min(...hell)).toBeGreaterThan(5.1);
    expect(Math.max(...hell)).toBeLessThan(14.5);
    expect(Math.min(...dunkel)).toBeGreaterThan(6.3);
    expect(Math.max(...dunkel)).toBeLessThan(12.9);
  });
});

// ─── 4. Wächter gegen harte Farben ──────────────────────────────────────────

describe("4. harteFarben", () => {
  const befunde = (css: string) => harteFarben(css, "neu-x.css").map((b) => `${b.zeile}:${b.text}`);

  it("meldet Hex, rgb und rgba in Deklarationen mit Zeile und Text", () => {
    const css = [".a {", "  background: #ffffff;", "  border: 1px solid rgba(0, 0, 0, 0.1);", "  color: rgb(34 34 36);", "}"].join("\n");
    expect(harteFarben(css, "neu-x.css")).toEqual([
      { datei: "neu-x.css", zeile: 2, text: "background: #ffffff;" },
      { datei: "neu-x.css", zeile: 3, text: "border: 1px solid rgba(0, 0, 0, 0.1);" },
      { datei: "neu-x.css", zeile: 4, text: "color: rgb(34 34 36);" },
    ]);
  });

  it("meldet rgb( auch im Schatten", () => {
    expect(befunde(".a {\n  box-shadow: 0 1px 2px rgb(0 0 0 / 0.06);\n}")).toEqual(["2:box-shadow: 0 1px 2px rgb(0 0 0 / 0.06);"]);
  });

  it("erlaubt Token-Definitionen", () => {
    expect(befunde("[data-neu] {\n  --ink: #222224;\n  --shadow: 0 1px 2px rgb(0 0 0 / 0.06);\n}")).toEqual([]);
  });

  it("erlaubt weiße Schrift, aber keine andere Hex-Schrift", () => {
    expect(befunde(".a {\n  color: #fff;\n  color: #FFFFFF;\n}")).toEqual([]);
    expect(befunde(".a {\n  color: #ffe;\n}")).toEqual(["2:color: #ffe;"]);
  });

  it("erlaubt Zeilen mit /* fest */", () => {
    expect(befunde(".logo {\n  background: #ffffff; /* fest */\n}")).toEqual([]);
    expect(befunde(".logo {\n  background: #ffffff; /* fest */ /* Logo-Kachel */\n}")).toEqual([]);
  });

  it("verbietet Akzentfarben als Textfarbe, nicht als Fläche oder *-ink", () => {
    expect(befunde(".a {\n  color: var(--blue);\n  color: var(--rose) ;\n}")).toEqual(["2:color: var(--blue);", "3:color: var(--rose) ;"]);
    expect(befunde(".a {\n  background: var(--blue);\n  color: var(--blue-ink);\n  outline: 2px solid var(--jade);\n}")).toEqual([]);
  });

  it("überspringt Kommentare, auch über mehrere Zeilen", () => {
    const css = ["/* Farben:", "  background: #000000;", "  ende */ .a {", "  color: #123456;", "}", "/* color: #abcdef; */"].join("\n");
    expect(befunde(css)).toEqual(["4:color: #123456;"]);
  });

  it("meldet Code nach dem Ende eines mehrzeiligen Kommentars", () => {
    const css = ["/* a", "b */ background: #101010;"].join("\n");
    expect(befunde(css)).toEqual(["2:b */ background: #101010;"]);
  });

  it("prüft Folgezeilen einer mehrzeiligen Deklaration (14b)", () => {
    const css = [".a {", "  box-shadow:", "    inset 0 1px 0 rgb(255 255 255 / 0.3),", "    var(--shadow);", "  color: var(--ink);", "}"].join("\n");
    expect(befunde(css)).toEqual(["3:inset 0 1px 0 rgb(255 255 255 / 0.3),"]);
    const fest = [".a {", "  box-shadow:", "    inset 0 1px 0 rgb(255 255 255 / 0.3), /* fest */", "    var(--shadow);", "}"].join("\n");
    expect(befunde(fest)).toEqual([]);
    const token = ["[data-neu] {", "  --schatten:", "    0 1px 2px rgb(0 0 0 / 0.1),", "    0 8px 24px rgb(0 0 0 / 0.2);", "}"].join("\n");
    expect(befunde(token)).toEqual([]);
  });

  it("endet die Fortsetzung am Semikolon", () => {
    const css = [".a {", "  grid-template-areas:", '    "a b";', "  width: 10px;", "}", "#kopf {", "}"].join("\n");
    expect(befunde(css)).toEqual([]);
  });

  it("ignoriert Selektoren und Hex-ähnliche Namen ohne Deklaration", () => {
    expect(befunde("#kopf .a,\n.b {\n  width: 10px;\n}")).toEqual([]);
  });
});

// ─── 5. Umleitung alter Pfade ───────────────────────────────────────────────

describe("5. Umleitung", () => {
  const leer = new URLSearchParams();
  const mitId = (muster: string, id: string) => muster.replace(":id", id);

  it("bildet jede Zeile der Zuordnung ab", () => {
    for (const z of ZUORDNUNG) {
      const pfad = mitId(z.alt, "abc");
      const erwartet = z.neu === null ? null : mitId(z.neu, "abc");
      expect(umleitZiel(pfad, leer), z.alt).toBe(erwartet);
    }
  });

  it("übernimmt :id kodiert", () => {
    expect(umleitZiel("/objects/people/a b", leer)).toBe("/app/kunden/a%20b");
    expect(umleitZiel("/objects/people/ä", leer)).toBe(`/app/kunden/${encodeURIComponent("ä")}`);
  });

  it("lässt eine Kennung mit Schrägstrich stehen", () => {
    expect(umleitZiel("/objects/people/a/b", leer)).toBeNull();
    expect(umleitZiel("/lists/a/b", leer)).toBeNull();
  });

  it("lässt unbekannte Unterpfade stehen", () => {
    expect(umleitZiel("/settings/whatsapp", leer)).toBeNull();
    expect(umleitZiel("/tasks/projects/1", leer)).toBeNull();
    expect(umleitZiel("/employees/x", leer)).toBeNull();
  });

  it("lässt ?alt=1 für jede Zeile stehen", () => {
    const alt = new URLSearchParams("alt=1");
    for (const z of ZUORDNUNG) {
      expect(umleitZiel(mitId(z.alt, "abc"), alt), z.alt).toBeNull();
    }
  });

  it("lässt jeden Eintrag von NIE_UMLEITEN stehen, auch mit Unterpfad", () => {
    for (const p of NIE_UMLEITEN) {
      expect(umleitZiel(p, leer), p).toBeNull();
      expect(umleitZiel(`${p}/x`, leer), `${p}/x`).toBeNull();
    }
  });

  it("leitet /inbox nur ohne Abfrage um", () => {
    expect(umleitZiel("/inbox", leer)).toBe("/app/inbox");
    expect(umleitZiel("/inbox", new URLSearchParams("conv=c"))).toBeNull();
    expect(umleitZiel("/inbox", new URLSearchParams("x=1"))).toBeNull();
  });

  it("lässt /objects/deals?create=1 stehen und leitet die Liste um", () => {
    expect(umleitZiel("/objects/deals", new URLSearchParams("create=1"))).toBeNull();
    expect(umleitZiel("/objects/deals", leer)).toBe("/app/leads");
  });

  it("lässt die Präfixe von Plan 10 stehen", () => {
    expect(umleitZiel("/objects/deals/d1", leer)).toBeNull();
    expect(umleitZiel("/inbox/gespraeche/1", leer)).toBeNull();
  });

  it("verwechselt /apple nicht mit /app", () => {
    expect(umleitZiel("/apple", leer)).toBeNull();
  });

  it("hat für jedes Ziel eine Seite unter app/(neu)", () => {
    const ziele = [...new Set(ZUORDNUNG.flatMap((z) => (z.neu ? [z.neu] : [])))];
    for (const ziel of ziele) {
      const rel = ziel.replace(/^\/app\//, "").replaceAll(":id", "[id]");
      const datei = fileURLToPath(new URL(`../app/(neu)/app/${rel}/page.tsx`, import.meta.url));
      expect(existsSync(datei), `${ziel} -> ${datei}`).toBe(true);
    }
  });
});

// ─── 6. PUT /quotation in Stufen ────────────────────────────────────────────

describe("6. Quotation-Stufen", () => {
  it("liest die Stufe; nur genau „sperren“ sperrt", () => {
    expect(quotationStufe(undefined)).toBe("zaehlen");
    expect(quotationStufe("")).toBe("zaehlen");
    expect(quotationStufe("zaehlen")).toBe("zaehlen");
    expect(quotationStufe("Sperren")).toBe("zaehlen");
    expect(quotationStufe("sperren")).toBe("sperren");
  });

  it.each([
    [{ authMethod: "cookie", uiHeader: "ui", mcpWerkzeug: null }, "ui"],
    [{ authMethod: "cookie", uiHeader: null, mcpWerkzeug: null }, "sitzung"],
    [{ authMethod: "cookie", uiHeader: "UI", mcpWerkzeug: null }, "sitzung"],
    [{ authMethod: undefined, uiHeader: null, mcpWerkzeug: null }, "sitzung"],
    [{ authMethod: "api_key", uiHeader: null, mcpWerkzeug: null }, "api_schluessel"],
    [{ authMethod: "api_key", uiHeader: "ui", mcpWerkzeug: null }, "api_schluessel"],
    [{ authMethod: "api_key", uiHeader: null, mcpWerkzeug: "crm_update_deal_quotation" }, "mcp_werkzeug"],
    [{ authMethod: "cookie", uiHeader: "ui", mcpWerkzeug: "crm_update_deal_quotation" }, "mcp_werkzeug"],
    [{ authMethod: "api_key", uiHeader: null, mcpWerkzeug: "crm_api" }, "mcp_crm_api"],
    [{ authMethod: "cookie", uiHeader: "ui", mcpWerkzeug: "crm_api" }, "mcp_crm_api"],
    [{ authMethod: "api_key", uiHeader: null, mcpWerkzeug: "crm_irgendwas" }, "api_schluessel"],
  ] as const)("erkennt %j als %s", (e, quelle) => {
    expect(quotationQuelle(e)).toBe(quelle);
  });

  it("lässt in Stufe sperren nur die Oberfläche schreiben", () => {
    const alle: QuotationQuelle[] = ["ui", "mcp_werkzeug", "mcp_crm_api", "api_schluessel", "sitzung"];
    for (const q of alle) {
      expect(quotationPutErlaubt("zaehlen", q), q).toBe(true);
      expect(quotationPutErlaubt("sperren", q), q).toBe(q === "ui");
    }
  });

  it("nennt Code 410 und das Ersatz-Werkzeug", () => {
    expect(QUOTATION_GESPERRT.status).toBe(410);
    expect(QUOTATION_GESPERRT.code).toBe("QUOTATION_PUT_GONE");
    expect(QUOTATION_GESPERRT.ersatz).toContain("crm_update_quotation_details");
  });

  describe("sperreBereit", () => {
    const tag = 24 * 60 * 60 * 1000;
    const jetzt = new Date("2026-12-20T12:00:00Z");
    const vor = (tage: number, ms = 0) => new Date(jetzt.getTime() - tage * tag + ms);

    it("braucht mindestens 30 Tage Zählung (29 nein, 30 ja)", () => {
      expect(sperreBereit(vor(ZAEHL_MIN_TAGE - 1), [], jetzt)).toEqual({ bereit: false, gruende: ["erst 29 von 30 Tagen gezählt"] });
      expect(sperreBereit(vor(ZAEHL_MIN_TAGE, 1), [], jetzt).bereit).toBe(false);
      expect(sperreBereit(vor(ZAEHL_MIN_TAGE), [], jetzt)).toEqual({ bereit: true, gruende: [] });
    });

    it("verlangt 14 Tage ohne Aufruf außer aus der Oberfläche (13 nein, 14 ja)", () => {
      const seit = vor(60);
      expect(sperreBereit(seit, [{ quelle: "mcp_werkzeug", am: vor(RUHE_TAGE - 1) }], jetzt)).toEqual({
        bereit: false,
        gruende: ["1 Aufrufe außerhalb der Oberfläche in den letzten 14 Tagen"],
      });
      expect(sperreBereit(seit, [{ quelle: "api_schluessel", am: vor(RUHE_TAGE) }], jetzt).bereit).toBe(false);
      expect(sperreBereit(seit, [{ quelle: "api_schluessel", am: vor(RUHE_TAGE, -1) }], jetzt).bereit).toBe(true);
      expect(sperreBereit(seit, [{ quelle: "ui", am: vor(0) }, { quelle: "ui", am: vor(1) }], jetzt).bereit).toBe(true);
    });

    it("nennt beide Gründe zusammen", () => {
      const r = sperreBereit(vor(3), [{ quelle: "sitzung", am: vor(1) }, { quelle: "mcp_crm_api", am: vor(2) }], jetzt);
      expect(r.bereit).toBe(false);
      expect(r.gruende).toEqual(["erst 3 von 30 Tagen gezählt", "2 Aufrufe außerhalb der Oberfläche in den letzten 14 Tagen"]);
    });
  });
});

// ─── 7. Ersatz-Werkzeug crm_update_quotation_details ────────────────────────

describe("7. quotationDetailsPruefen", () => {
  const ok = (roh: unknown) => {
    const r = quotationDetailsPruefen(roh);
    if (!r.ok) throw new Error(r.fehler);
    return r.patch;
  };
  const fehler = (roh: unknown) => {
    const r = quotationDetailsPruefen(roh);
    if (r.ok) throw new Error(`erwartet Fehler, bekam ${JSON.stringify(r.patch)}`);
    return r.fehler;
  };

  it("verlangt ein Objekt mit mindestens einem Feld", () => {
    expect(fehler(null)).toBe("Body muss ein Objekt sein");
    expect(fehler([])).toBe("Body muss ein Objekt sein");
    expect(fehler("notes")).toBe("Body muss ein Objekt sein");
    expect(fehler({})).toBe("Keine Felder angegeben");
  });

  it("lehnt unbekannte Felder ab, auch Preisfelder", () => {
    expect(fehler({ notes: "a", fixedPrice: "100" })).toBe("Unbekannte Felder: fixedPrice");
    expect(fehler({ discount: null, lineItems: [] })).toBe("Unbekannte Felder: discount, lineItems");
    expect(fehler({ calculationVersionId: "v1" })).toBe("Unbekannte Felder: calculationVersionId");
  });

  it("prüft validUntil als Kalendertag oder null", () => {
    expect(ok({ validUntil: "2026-12-31" })).toEqual({ validUntil: "2026-12-31" });
    expect(ok({ validUntil: null })).toEqual({ validUntil: null });
    for (const v of ["2026-13-01", "31.12.2026", "2026-12-31T00:00:00Z", "", 20261231, true]) {
      expect(fehler({ validUntil: v }), String(v)).toBe("validUntil muss YYYY-MM-DD oder null sein");
    }
  });

  it.each(["notes", "summary", "paymentMethodPreference"] as const)("prüft %s als Text bis zur Grenze, trimmt und leert zu null", (k) => {
    expect(ok({ [k]: "  Hallo  " })).toEqual({ [k]: "Hallo" });
    expect(ok({ [k]: "   " })).toEqual({ [k]: null });
    expect(ok({ [k]: null })).toEqual({ [k]: null });
    expect(ok({ [k]: "x".repeat(DETAILS_TEXT_MAX) })).toEqual({ [k]: "x".repeat(DETAILS_TEXT_MAX) });
    expect(fehler({ [k]: "x".repeat(DETAILS_TEXT_MAX + 1) })).toBe(`${k} muss Text bis ${DETAILS_TEXT_MAX} Zeichen oder null sein`);
    expect(fehler({ [k]: 5 })).toBe(`${k} muss Text bis ${DETAILS_TEXT_MAX} Zeichen oder null sein`);
  });

  it("prüft serviceType gegen die vier Leistungen", () => {
    for (const t of SERVICE_TYPES) expect(ok({ serviceType: t })).toEqual({ serviceType: t });
    for (const v of [null, "umzug", "Move", 1]) {
      expect(fehler({ serviceType: v }), String(v)).toBe(`serviceType muss einer von ${SERVICE_TYPES.join(", ")} sein`);
    }
  });

  it("prüft showStandardInclusions als Wahrheitswert", () => {
    expect(ok({ showStandardInclusions: false })).toEqual({ showStandardInclusions: false });
    expect(fehler({ showStandardInclusions: "false" })).toBe("showStandardInclusions muss true oder false sein");
    expect(fehler({ showStandardInclusions: null })).toBe("showStandardInclusions muss true oder false sein");
  });

  it("nimmt alle sechs Felder zusammen an", () => {
    expect(
      ok({
        validUntil: "2026-12-01",
        notes: "intern",
        summary: "3 Zimmer",
        serviceType: "clearance_move",
        paymentMethodPreference: "bank_transfer",
        showStandardInclusions: true,
      })
    ).toEqual({
      validUntil: "2026-12-01",
      notes: "intern",
      summary: "3 Zimmer",
      serviceType: "clearance_move",
      paymentMethodPreference: "bank_transfer",
      showStandardInclusions: true,
    });
  });

  it("erlaubt nach der Annahme nur notes", () => {
    expect([...NACH_ANNAHME_ERLAUBT]).toEqual(["notes"]);
  });
});

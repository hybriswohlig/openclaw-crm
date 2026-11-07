import { describe, expect, it } from "vitest";
import {
  akteLinkAusHref,
  altesZiel,
  altUmleitung,
  anrufDialogLage,
  istId,
  kundeLink,
  KUNDENAKTE_NEU,
  mitAlt,
  nachVerfassenSchluessel,
  NEUER_LEAD_TEXT,
  neuerLeadEntscheid,
  neuerLeadPruefen,
  neuesZiel,
  uiCookieWert,
  verfassenAus,
  verfassenUrl,
  weiterLink,
  weiterZielAus,
} from "./handy-links";

const p = (s: string) => new URLSearchParams(s);

describe("altUmleitung", () => {
  it("leitet einen Deal ohne Abfrage zur Weiche", () => {
    expect(altUmleitung("/objects/deals/abc", p(""), "neu")).toBe("/weiter?deal=abc");
    expect(altUmleitung("/objects/deals/abc/", p(""), "neu")).toBe("/weiter?deal=abc");
  });

  it("lässt Deals mit jeder Abfrage alt", () => {
    expect(altUmleitung("/objects/deals/abc", p("tab=quotation"), "neu")).toBeNull();
    expect(altUmleitung("/objects/deals/abc", p("alt=1"), "neu")).toBeNull();
    expect(altUmleitung("/objects/deals/abc", p("x=1"), "neu")).toBeNull();
  });

  it("fasst Liste und Unterpfade nicht an", () => {
    expect(altUmleitung("/objects/deals", p(""), "neu")).toBeNull();
    expect(altUmleitung("/objects/deals/a/b", p(""), "neu")).toBeNull();
    expect(altUmleitung("/objects/people/a", p(""), "neu")).toBeNull();
  });

  it("leitet nur bei Cookie neu", () => {
    expect(altUmleitung("/objects/deals/abc", p(""), "alt")).toBeNull();
    expect(altUmleitung("/objects/deals/abc", p(""), undefined)).toBeNull();
    expect(altUmleitung("/objects/deals/abc", p(""), null)).toBeNull();
    expect(altUmleitung("/objects/deals/abc", p(""), "quatsch")).toBeNull();
    expect(altUmleitung("/inbox", p("conv=c"), "alt")).toBeNull();
  });

  it("leitet /inbox?conv= zur Weiche", () => {
    expect(altUmleitung("/inbox", p("conv=c"), "neu")).toBe("/weiter?conv=c");
    expect(altUmleitung("/inbox", p("conv=c&merged=1"), "neu")).toBe("/weiter?conv=c");
    expect(altUmleitung("/inbox/", p("conv=c"), "neu")).toBe("/weiter?conv=c");
  });

  it("lässt /inbox mit alt, compose, ohne conv oder ungültigem conv alt", () => {
    expect(altUmleitung("/inbox", p("conv=c&alt=1"), "neu")).toBeNull();
    expect(altUmleitung("/inbox", p("compose=1"), "neu")).toBeNull();
    expect(altUmleitung("/inbox", p("conv=c&compose=1"), "neu")).toBeNull();
    expect(altUmleitung("/inbox", p(""), "neu")).toBeNull();
    expect(altUmleitung("/inbox", p("conv=../x"), "neu")).toBeNull();
  });

  it("lehnt eine ungültige Deal-Kennung ab", () => {
    expect(altUmleitung("/objects/deals/a%2Fb", p(""), "neu")).toBeNull();
  });
});

describe("Weiche: Ziele", () => {
  it("weiterZielAus: conv vor deal, ungültig zählt als fehlend", () => {
    expect(weiterZielAus(p("conv=c&deal=d"))).toEqual({ art: "gespraech", id: "c" });
    expect(weiterZielAus(p("deal=d"))).toEqual({ art: "deal", id: "d" });
    expect(weiterZielAus(p("conv=../x&deal=d"))).toEqual({ art: "deal", id: "d" });
    expect(weiterZielAus(p("conv=../x"))).toEqual({ art: "inbox" });
    expect(weiterZielAus(p(""))).toEqual({ art: "inbox" });
  });

  it("weiterLink baut die drei Formen", () => {
    expect(weiterLink({ art: "gespraech", id: "c1" })).toBe("/weiter?conv=c1");
    expect(weiterLink({ art: "deal", id: "d1" })).toBe("/weiter?deal=d1");
    expect(weiterLink({ art: "inbox" })).toBe("/weiter");
  });

  it("neuesZiel mit und ohne Deal", () => {
    expect(neuesZiel({ art: "deal", id: "d1" }, null)).toBe("/app/leads/d1");
    expect(neuesZiel({ art: "gespraech", id: "c1" }, "d1")).toBe("/app/inbox?e=deal%3Ad1");
    expect(neuesZiel({ art: "gespraech", id: "c1" }, null)).toBe("/app/inbox?e=gespraech%3Ac1");
    expect(neuesZiel({ art: "gespraech", id: "c1" }, "../x")).toBe("/app/inbox?e=gespraech%3Ac1");
    expect(neuesZiel({ art: "inbox" }, null)).toBe("/app/inbox");
  });

  it("altesZiel trägt bei Deal und Gespräch immer alt=1", () => {
    expect(altesZiel({ art: "deal", id: "d1" })).toBe("/objects/deals/d1?alt=1");
    expect(altesZiel({ art: "gespraech", id: "c1" })).toBe("/inbox?conv=c1&alt=1");
    expect(altesZiel({ art: "inbox" })).toBe("/inbox");
    // Kein Ziel der alten Seite löst die Umleitung erneut aus.
    for (const z of [altesZiel({ art: "deal", id: "d1" }), altesZiel({ art: "gespraech", id: "c1" })]) {
      const u = new URL(z, "https://x.test");
      expect(altUmleitung(u.pathname, u.searchParams, "neu")).toBeNull();
    }
  });

  it("mitAlt ist idempotent und behält vorhandene Abfragen", () => {
    expect(mitAlt("/objects/deals/d1")).toBe("/objects/deals/d1?alt=1");
    expect(mitAlt(mitAlt("/objects/deals/d1"))).toBe("/objects/deals/d1?alt=1");
    expect(mitAlt("/inbox?conv=c1")).toBe("/inbox?conv=c1&alt=1");
    expect(mitAlt("/inbox?conv=c1&alt=1")).toBe("/inbox?conv=c1&alt=1");
  });

  it("istId und uiCookieWert", () => {
    expect(istId("abc_-1")).toBe(true);
    expect(istId("")).toBe(false);
    expect(istId("a".repeat(65))).toBe(false);
    expect(istId(null)).toBe(false);
    expect(uiCookieWert("neu")).toBe("neu");
    expect(uiCookieWert("alt")).toBe("alt");
    expect(uiCookieWert("x")).toBeNull();
  });
});

describe("akteLinkAusHref und kundeLink", () => {
  it("macht aus einem Deal-Href die Weiche, anderes bleibt", () => {
    expect(akteLinkAusHref("/objects/deals/d1")).toBe("/weiter?deal=d1");
    expect(akteLinkAusHref("/objects/people/p1")).toBe("/objects/people/p1");
    expect(akteLinkAusHref("/objects/deals/d1?tab=x")).toBe("/objects/deals/d1?tab=x");
  });

  it("kundeLink folgt dem Schalter", () => {
    expect(kundeLink("p1")).toBe(KUNDENAKTE_NEU ? "/app/kunden/p1" : "/objects/people/p1");
  });
});

describe("Verfassen", () => {
  it("geht rund", () => {
    const v = { channelAccountId: "k1", telefon: "+4917012345", name: "Frau Muster", dealRecordId: "d1" };
    const url = verfassenUrl(v);
    expect(url.startsWith("/app/inbox?verfassen=1")).toBe(true);
    expect(verfassenAus(new URL(url, "https://x.test").searchParams)).toEqual(v);
  });

  it("lässt leere Felder weg", () => {
    expect(verfassenUrl({ channelAccountId: null, telefon: null, name: null, dealRecordId: null })).toBe(
      "/app/inbox?verfassen=1"
    );
    expect(verfassenAus(p("verfassen=1"))).toEqual({
      channelAccountId: null,
      telefon: null,
      name: null,
      dealRecordId: null,
    });
  });

  it("verwirft zu lange und ungültige Werte", () => {
    const r = verfassenAus(p(`verfassen=1&telefon=${"1".repeat(33)}&name=${"a".repeat(121)}&kanal=../x&deal=a/b`));
    expect(r).toEqual({ channelAccountId: null, telefon: null, name: null, dealRecordId: null });
  });

  it("ohne verfassen=1 null", () => {
    expect(verfassenAus(p("telefon=1"))).toBeNull();
    expect(verfassenAus(p("verfassen=0"))).toBeNull();
  });

  it("nachVerfassenSchluessel", () => {
    expect(nachVerfassenSchluessel("c1", "d1")).toBe("deal:d1");
    expect(nachVerfassenSchluessel("c1", null)).toBe("gespraech:c1");
  });
});

describe("neuerLeadPruefen", () => {
  const quellen = ["Telefon", "Website"] as const;
  const gut = {
    name: "Frau  Muster",
    telefon: " 0170 1234567 ",
    email: "",
    firmaId: "f1",
    quelle: "Telefon",
    umzugsdatum: "2026-12-01",
  };

  it("nimmt gültige Eingaben an und glättet", () => {
    const r = neuerLeadPruefen(gut, quellen);
    expect(r).toEqual({
      ok: true,
      eingabe: {
        name: "Frau Muster",
        telefon: "0170 1234567",
        email: null,
        firmaId: "f1",
        quelle: "Telefon",
        umzugsdatum: "2026-12-01",
        personWahl: null,
      },
    });
  });

  it("schreibt die E-Mail klein", () => {
    const r = neuerLeadPruefen({ ...gut, telefon: "", email: "A@B.DE" }, quellen);
    expect(r.ok && r.eingabe.email).toBe("a@b.de");
  });

  const falsch: Array<[string, Record<string, unknown>, string]> = [
    ["name zu kurz", { name: "A" }, "name"],
    ["name nur Ziffern", { name: "0170 123" }, "name"],
    ["kein Kontakt", { telefon: "", email: "" }, "kontakt"],
    ["Telefon zu lang", { telefon: "1".repeat(33) }, "kontakt"],
    ["E-Mail kaputt", { email: "nicht-gueltig" }, "email"],
    ["Firma fehlt", { firmaId: "" }, "firma"],
    ["Quelle fremd", { quelle: "Fax" }, "quelle"],
    ["Datum ungültig", { umzugsdatum: "2026-02-30" }, "umzugsdatum"],
    ["Wahl kaputt", { personWahl: { art: "bestehend" } }, "personWahl"],
  ];
  for (const [titel, aenderung, feld] of falsch) {
    it(`lehnt ab: ${titel}`, () => {
      const r = neuerLeadPruefen({ ...gut, ...aenderung }, quellen);
      expect(r).toEqual({ ok: false, feld, text: NEUER_LEAD_TEXT[feld as keyof typeof NEUER_LEAD_TEXT] });
    });
  }

  it("lehnt Nicht-Objekte ab", () => {
    expect(neuerLeadPruefen(null, quellen).ok).toBe(false);
    expect(neuerLeadPruefen([], quellen).ok).toBe(false);
  });

  it("übernimmt eine gültige Wahl", () => {
    const r = neuerLeadPruefen({ ...gut, personWahl: { art: "bestehend", personId: "p1" } }, quellen);
    expect(r.ok && r.eingabe.personWahl).toEqual({ art: "bestehend", personId: "p1" });
    const n = neuerLeadPruefen({ ...gut, personWahl: { art: "neu" } }, quellen);
    expect(n.ok && n.eingabe.personWahl).toEqual({ art: "neu" });
  });
});

describe("neuerLeadEntscheid", () => {
  const t = [{ id: "p1", name: "Anna" }];
  it("keine Treffer legt neu an", () => {
    expect(neuerLeadEntscheid([], null)).toEqual({ art: "anlegen", person: { neu: true } });
  });
  it("Treffer ohne Wahl fragt nach", () => {
    expect(neuerLeadEntscheid(t, null)).toEqual({ art: "rueckfrage", treffer: t });
  });
  it("Wahl neu legt neu an", () => {
    expect(neuerLeadEntscheid(t, { art: "neu" })).toEqual({ art: "anlegen", person: { neu: true } });
  });
  it("Wahl eines Treffers nimmt ihn", () => {
    expect(neuerLeadEntscheid(t, { art: "bestehend", personId: "p1" })).toEqual({
      art: "anlegen",
      person: { neu: false, id: "p1" },
    });
  });
  it("Wahl außerhalb der Treffer fragt nach", () => {
    expect(neuerLeadEntscheid(t, { art: "bestehend", personId: "p9" })).toEqual({ art: "rueckfrage", treffer: t });
  });
  it("bestehend ohne Treffer fragt nach", () => {
    expect(neuerLeadEntscheid([], { art: "bestehend", personId: "p1" })).toEqual({ art: "rueckfrage", treffer: [] });
  });
});

describe("anrufDialogLage", () => {
  const anna = { id: "p1", name: "Anna" };
  const bert = { id: "p2", name: "Bert" };
  const l1 = { id: "d1", name: "Umzug 1" };
  const l2 = { id: "d2", name: "Umzug 2" };
  const basis = { matchStatus: "unmatched", dealRecordId: null, karten: [], bestehendePerson: null, offeneLeads: [] };

  it("mit Deal oder matched: keiner", () => {
    expect(anrufDialogLage({ ...basis, dealRecordId: "d1" })).toEqual({ art: "keiner" });
    expect(anrufDialogLage({ ...basis, matchStatus: "matched" })).toEqual({ art: "keiner" });
  });
  it("zwei Karten: Person wählen", () => {
    expect(anrufDialogLage({ ...basis, matchStatus: "ambiguous", karten: [anna, bert] })).toEqual({
      art: "person_waehlen",
      treffer: [anna, bert],
    });
  });
  it("ambiguous ohne Karten: keiner", () => {
    expect(anrufDialogLage({ ...basis, matchStatus: "ambiguous" })).toEqual({ art: "keiner" });
  });
  it("Person mit zwei offenen Leads: Lead wählen", () => {
    expect(anrufDialogLage({ ...basis, bestehendePerson: anna, offeneLeads: [l1, l2] })).toEqual({
      art: "lead_waehlen",
      person: anna,
      leads: [l1, l2],
    });
  });
  it("Person mit einem offenen Lead: an Lead", () => {
    expect(anrufDialogLage({ ...basis, bestehendePerson: anna, offeneLeads: [l1] })).toEqual({
      art: "an_lead",
      person: anna,
      lead: l1,
    });
  });
  it("Person ohne Lead oder niemand: neuer Lead", () => {
    expect(anrufDialogLage({ ...basis, bestehendePerson: anna })).toEqual({ art: "neuer_lead", person: anna });
    expect(anrufDialogLage(basis)).toEqual({ art: "neuer_lead", person: null });
  });
});

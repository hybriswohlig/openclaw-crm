import { describe, expect, it } from "vitest";
import { isQuietHoursBerlin } from "@/lib/reviews/quiet-hours";
import {
  ANKER_VERZUG_MS,
  AUTO_FRIST_TAGE,
  BACKFILL_STICHTAG,
  autoKandidat,
  bewertungEinwilligungAus,
  bewertungLage,
  dublettenSchluessel,
  einwilligungsWortlaut,
  EINWILLIGUNG_PORTAL,
  fensterText,
  gespraecheJeFirma,
  istWiederkehrer,
  klickDatenAbgelaufen,
  kundenArt,
  kundenSuche,
  markeAusFirmenname,
  naechstesFenster,
  offenSumme,
  portalAnrede,
  rechnungMitGoogleHinweis,
  SPERR_TEXT,
  tokenFreigebbar,
  tokenLage,
  vormerkungSendebereit,
  type AutoKandidatEingabe,
  type BewertungListenRoh,
  type FirmaKurz,
  type KundenGespraech,
} from "./bewertungen-kunden";

const iso = (s: string) => new Date(s);
const STUNDE = 60 * 60 * 1000;

describe("naechstesFenster", () => {
  it("Samstag 20 Uhr → Montag 9 Uhr (Winterzeit)", () => {
    // Sa 14.11.2026 20:00 Berlin = 19:00 UTC
    expect(naechstesFenster(iso("2026-11-14T19:00:00Z")).toISOString()).toBe("2026-11-16T08:00:00.000Z");
  });
  it("Sonntag mittags → Montag 9 Uhr", () => {
    expect(naechstesFenster(iso("2026-11-15T11:00:00Z")).toISOString()).toBe("2026-11-16T08:00:00.000Z");
  });
  it("vor 9 Uhr an einem Werktag → derselbe Tag 9 Uhr", () => {
    expect(naechstesFenster(iso("2026-11-10T05:30:00Z")).toISOString()).toBe("2026-11-10T08:00:00.000Z");
  });
  it("nach 19 Uhr an einem Werktag → nächster Tag 9 Uhr", () => {
    expect(naechstesFenster(iso("2026-11-10T18:30:00Z")).toISOString()).toBe("2026-11-11T08:00:00.000Z");
  });
  it("im Fenster unverändert", () => {
    const d = iso("2026-11-10T12:34:56Z");
    expect(naechstesFenster(d)).toBe(d);
  });
  it("März-Umstellung: Sa 28.03.2027 abends → Mo 29.03. 9 Uhr Sommerzeit", () => {
    // Umstellung So 28.03.2027. Sa 27.03. 20:00 MEZ = 19:00 UTC.
    expect(naechstesFenster(iso("2027-03-27T19:00:00Z")).toISOString()).toBe("2027-03-29T07:00:00.000Z");
  });
  it("Oktober-Umstellung: Sa 24.10.2026 abends → Mo 26.10. 9 Uhr Winterzeit", () => {
    // Umstellung So 25.10.2026. Sa 24.10. 20:00 MESZ = 18:00 UTC.
    expect(naechstesFenster(iso("2026-10-24T18:00:00Z")).toISOString()).toBe("2026-10-26T08:00:00.000Z");
  });
  it("Schleife über drei Wochen um beide Umstellungen: Ergebnis liegt im Fenster und ist frühestmöglich", () => {
    for (const start of ["2026-10-17T00:00:00Z", "2027-03-20T00:00:00Z"]) {
      const s = Date.parse(start);
      for (let t = s; t < s + 21 * 24 * STUNDE; t += 15 * 60 * 1000) {
        const ab = new Date(t);
        const f = naechstesFenster(ab);
        expect(isQuietHoursBerlin(f)).toBe(false);
        expect(f.getTime()).toBeGreaterThanOrEqual(t);
        // 15 Minuten früher (falls nach ab) wäre noch Ruhezeit
        if (f.getTime() > t) {
          expect(isQuietHoursBerlin(new Date(f.getTime() - 15 * 60 * 1000))).toBe(true);
          expect(fensterText(f)).toMatch(/^(Mo|Di|Mi|Do|Fr|Sa) \d\d\.\d\d\., 9 Uhr$/);
        }
      }
    }
  });
  it("fensterText", () => {
    expect(fensterText(iso("2026-11-16T08:00:00Z"))).toBe("Mo 16.11., 9 Uhr");
    expect(fensterText(iso("2026-11-16T08:30:00Z"))).toBe("Mo 16.11., 9:30 Uhr");
  });
});

describe("Kleinteile", () => {
  it("rechnungMitGoogleHinweis nur bei aus oder ohne Einstellung", () => {
    expect(rechnungMitGoogleHinweis(null)).toBe(true);
    expect(rechnungMitGoogleHinweis("aus")).toBe(true);
    expect(rechnungMitGoogleHinweis("entwurf")).toBe(false);
    expect(rechnungMitGoogleHinweis("senden")).toBe(false);
  });
  it("klickDatenAbgelaufen nach 90 Tagen", () => {
    const j = iso("2026-11-08T00:00:00Z");
    expect(klickDatenAbgelaufen(iso("2026-08-09T00:00:00Z"), j)).toBe(true);
    expect(klickDatenAbgelaufen(iso("2026-08-11T00:00:00Z"), j)).toBe(false);
  });
  it("markeAusFirmenname", () => {
    expect(markeAusFirmenname("Umzüge Kottke GmbH")).toBe("kottke");
    expect(markeAusFirmenname("CEYLAN Transporte")).toBe("ceylan");
    expect(markeAusFirmenname(null)).toBeNull();
  });
  it("Portal: Anrede, Wortlaut, nur true zählt", () => {
    expect(portalAnrede("ceylan")).toBe("sie");
    expect(portalAnrede("kottke")).toBe("du");
    expect(einwilligungsWortlaut("du")).toContain(EINWILLIGUNG_PORTAL.du.frage);
    expect(einwilligungsWortlaut("sie")).toContain(EINWILLIGUNG_PORTAL.sie.hinweis);
    for (const t of Object.values(EINWILLIGUNG_PORTAL)) {
      expect(t.frage + t.hinweis).not.toMatch(/[–—]/);
    }
    expect(bewertungEinwilligungAus({ bewertungEinwilligung: true })).toBe(true);
    for (const v of [null, undefined, "x", [], {}, { bewertungEinwilligung: "true" }, { bewertungEinwilligung: 1 }, [true]]) {
      expect(bewertungEinwilligungAus(v)).toBe(false);
    }
  });
  it("offenSumme", () => {
    expect(offenSumme([])).toBeNull();
    expect(offenSumme([null, null])).toBeNull();
    expect(offenSumme([100, null, 0, 50])).toBe(150);
  });
  it("SPERR_TEXT ohne Gedankenstriche", () => {
    for (const t of Object.values(SPERR_TEXT)) expect(t).not.toMatch(/[–—]/);
  });
});

describe("tokenLage und Vormerkung", () => {
  const jetzt = iso("2026-11-10T12:00:00Z");
  it("tokenLage", () => {
    expect(tokenLage({ zustand: "anspruch", createdAt: iso("2026-11-10T11:55:00Z"), clickedAt: null }, jetzt)).toBe("laeuft");
    expect(tokenLage({ zustand: "anspruch", createdAt: iso("2026-11-10T11:49:00Z"), clickedAt: null }, jetzt)).toBe("unklar");
    expect(tokenLage({ zustand: "unklar", createdAt: jetzt, clickedAt: null }, jetzt)).toBe("unklar");
    expect(tokenLage({ zustand: "gesendet", createdAt: jetzt, clickedAt: null }, jetzt)).toBe("gesendet");
    expect(tokenLage({ zustand: "unklar", createdAt: jetzt, clickedAt: jetzt }, jetzt)).toBe("geklickt");
    expect(tokenFreigebbar("unklar")).toBe(true);
    expect(tokenFreigebbar("gesendet")).toBe(false);
  });
  it("vormerkungSendebereit", () => {
    const v = { art: "auto" as const, status: "offen" as const, faelligAb: iso("2026-11-10T08:00:00Z"), fristBis: iso("2026-11-20T00:00:00Z") };
    expect(vormerkungSendebereit(v, jetzt)).toBe("senden");
    expect(vormerkungSendebereit({ ...v, art: "entwurf" }, jetzt)).toBe("nie");
    expect(vormerkungSendebereit({ ...v, status: "gesendet" }, jetzt)).toBe("nie");
    expect(vormerkungSendebereit({ ...v, faelligAb: iso("2026-11-11T08:00:00Z") }, jetzt)).toBe("warten");
    expect(vormerkungSendebereit(v, iso("2026-11-15T12:00:00Z"))).toBe("warten"); // Sonntag
    expect(vormerkungSendebereit(v, iso("2026-11-21T12:00:00Z"))).toBe("frist");
  });
});

describe("autoKandidat", () => {
  const bezahlt = iso("2026-11-09T10:00:00Z");
  const basis: AutoKandidatEingabe = {
    modus: "senden",
    modusSeit: iso("2026-11-01T00:00:00Z"),
    bezahltAm: bezahlt,
    stufe: "paid",
    statusTitel: null,
    nichtKontaktieren: false,
    tokenDa: false,
    offeneVormerkung: false,
    kontaktart: null,
  };
  const jetzt = new Date(bezahlt.getTime() + ANKER_VERZUG_MS + STUNDE); // Di 11:00 UTC
  const grund = (e: Partial<AutoKandidatEingabe>, j = jetzt) => {
    const r = autoKandidat({ ...basis, ...e }, j);
    return r.ok ? "ok" : r.grund;
  };

  it("ok mit Art je Modus und Frist", () => {
    const r = autoKandidat(basis, jetzt);
    expect(r).toEqual({
      ok: true,
      art: "auto",
      faelligAb: jetzt,
      fristBis: new Date(bezahlt.getTime() + ANKER_VERZUG_MS + AUTO_FRIST_TAGE * 24 * STUNDE),
    });
    const e = autoKandidat({ ...basis, modus: "entwurf" }, jetzt);
    expect(e.ok && e.art).toBe("entwurf");
    expect(grund({ stufe: "done_unpaid", kontaktart: "lead_kunde", statusTitel: "not_due" })).toBe("ok");
  });
  it("Gründe", () => {
    expect(grund({ modus: "aus" })).toBe("MODUS");
    expect(grund({ bezahltAm: null })).toBe("KEIN_ANKER");
    expect(grund({ modusSeit: null })).toBe("ALTAUFTRAG");
    expect(grund({ modusSeit: iso("2026-11-09T10:00:01Z") })).toBe("ALTAUFTRAG");
    expect(grund({ stufe: "booked" })).toBe("STUFE");
    expect(grund({ stufe: null })).toBe("STUFE");
    expect(grund({ kontaktart: "bewerber" })).toBe("KONTAKTART");
    expect(grund({ tokenDa: true })).toBe("SCHON_GESENDET");
    expect(grund({ statusTitel: "sent_whatsapp" })).toBe("SCHON_GESENDET");
    expect(grund({ statusTitel: "complaint_routed" })).toBe("BESCHWERDE_STATUS");
    expect(grund({ nichtKontaktieren: true })).toBe("NICHT_KONTAKTIEREN");
    expect(grund({ offeneVormerkung: true })).toBe("VORGEMERKT");
    expect(grund({}, new Date(bezahlt.getTime() + ANKER_VERZUG_MS - 1))).toBe("NOCH_NICHT");
    expect(grund({}, new Date(bezahlt.getTime() + ANKER_VERZUG_MS + (AUTO_FRIST_TAGE * 24 + 1) * STUNDE))).toBe("FRIST");
  });
  it("berechtigt in der Ruhezeit → fällig im nächsten Fenster", () => {
    // Anker Fr 13.11. 20:00 Berlin → berechtigt Sa 14.11. 20:00 → Mo 16.11. 9 Uhr
    const b = iso("2026-11-13T19:00:00Z");
    const r = autoKandidat({ ...basis, bezahltAm: b }, iso("2026-11-14T19:30:00Z"));
    expect(r.ok && r.faelligAb.toISOString()).toBe("2026-11-16T08:00:00.000Z");
  });
});

describe("bewertungLage", () => {
  const jetzt = iso("2026-11-10T12:00:00Z");
  const roh: BewertungListenRoh = {
    dealId: "d1",
    stufe: "paid",
    statusTitel: null,
    nichtKontaktieren: false,
    nichtKontaktierenSeit: null,
    token: null,
    vormerkung: null,
    hatPerson: true,
    hatGoogleLink: true,
    kontaktart: null,
  };
  const lage = (e: Partial<BewertungListenRoh>) => bewertungLage({ ...roh, ...e }, jetzt);

  it("je Liste", () => {
    expect(lage({})).toEqual({ liste: "faellig", grund: null, faelligAb: null });
    expect(lage({ token: { zustand: "gesendet", createdAt: jetzt, clickedAt: null, quelle: "hand" } }).liste).toBe("angefragt");
    expect(lage({ token: { zustand: "anspruch", createdAt: jetzt, clickedAt: null, quelle: "hand" } }).liste).toBe("angefragt");
    expect(lage({ token: { zustand: "gesendet", createdAt: jetzt, clickedAt: jetzt, quelle: "hand" } }).liste).toBe("geklickt");
    expect(lage({ token: { zustand: "unklar", createdAt: jetzt, clickedAt: null, quelle: "alt" } })).toMatchObject({ liste: "gesperrt", grund: "VERSAND_UNKLAR" });
    expect(lage({ statusTitel: "sent_sms" }).liste).toBe("angefragt");
    expect(lage({ statusTitel: "review_left" }).liste).toBe("geklickt");
    expect(lage({ statusTitel: "complaint_routed" })).toMatchObject({ liste: "gesperrt", grund: "BESCHWERDE_STATUS" });
    expect(lage({ statusTitel: "suppressed" })).toMatchObject({ liste: "gesperrt", grund: "ABGEMELDET" });
    expect(lage({ nichtKontaktieren: true, nichtKontaktierenSeit: jetzt })).toMatchObject({ grund: "NICHT_KONTAKTIEREN" });
    expect(lage({ nichtKontaktieren: true, nichtKontaktierenSeit: new Date(BACKFILL_STICHTAG.getTime() - 1) })).toMatchObject({ grund: "ALTSPERRE" });
    expect(lage({ kontaktart: "spam_werbung" })).toMatchObject({ liste: "gesperrt", grund: "KONTAKTART" });
    const f = iso("2026-11-11T08:00:00Z");
    expect(lage({ vormerkung: { art: "entwurf", status: "offen", faelligAb: f, sperre: null } })).toEqual({ liste: "freigabe", grund: null, faelligAb: f });
    expect(lage({ vormerkung: { art: "hand", status: "offen", faelligAb: f, sperre: null } })).toEqual({ liste: "vorgemerkt", grund: null, faelligAb: f });
    expect(lage({ vormerkung: { art: "auto", status: "gesperrt", faelligAb: f, sperre: "BESCHWERDE" } })).toMatchObject({ liste: "gesperrt", grund: "BESCHWERDE" });
    expect(lage({ vormerkung: { art: "auto", status: "gesperrt", faelligAb: f, sperre: "UNSINN" } })).toMatchObject({ grund: "FEHLGESCHLAGEN" });
    expect(lage({ vormerkung: { art: "auto", status: "gesperrt", faelligAb: f, sperre: "FRIST" } })).toEqual({ liste: "faellig", grund: "FRIST", faelligAb: null });
    expect(lage({ hatPerson: false })).toMatchObject({ liste: "gesperrt", grund: "EMPFAENGER" });
    expect(lage({ hatGoogleLink: false })).toMatchObject({ liste: "gesperrt", grund: "KEIN_LINK" });
  });
});

describe("Kunden", () => {
  it("kundenSuche Telefon in vielen Schreibweisen", () => {
    for (const q of ["+49 171 1234567", "0049 171 1234567", "0171 1234567", "0171/1234567", "+49 (171) 123-45-67"]) {
      expect(kundenSuche(q)).toEqual({ art: "telefon", e164: "+491711234567" });
    }
  });
  it("kundenSuche Deal-Nummer, E-Mail, Name, leer", () => {
    expect(kundenSuche(" 2026-014 ")).toEqual({ art: "dealnummer", nummer: "2026-014" });
    expect(kundenSuche("Max@Example.DE")).toEqual({ art: "email", text: "max@example.de" });
    expect(kundenSuche("Müller")).toEqual({ art: "name", text: "Müller" });
    expect(kundenSuche("12345")).toEqual({ art: "name", text: "12345" });
    expect(kundenSuche("a")).toEqual({ art: "leer" });
    expect(kundenSuche("   ")).toEqual({ art: "leer" });
  });
  it("kundenArt und Wiederkehrer", () => {
    expect(kundenArt({ kontaktart: null, dealKategorien: ["quoted"], aktiveAnnahme: false })).toBe("anfrage");
    expect(kundenArt({ kontaktart: null, dealKategorien: ["quoted"], aktiveAnnahme: true })).toBe("kunde");
    expect(kundenArt({ kontaktart: "lead_kunde", dealKategorien: ["booked"], aktiveAnnahme: false })).toBe("kunde");
    expect(kundenArt({ kontaktart: "privat", dealKategorien: ["paid"], aktiveAnnahme: false })).toBe("kunde");
    for (const k of ["bewerber", "team_helfer", "spam_werbung"] as const) {
      expect(kundenArt({ kontaktart: k, dealKategorien: ["paid"], aktiveAnnahme: true })).toBe("nie");
    }
    expect(istWiederkehrer(["paid", "booked"])).toBe(true);
    expect(istWiederkehrer(["paid", "lost", null])).toBe(false);
  });
  it("dublettenSchluessel mit Umlauten und Reihenfolge", () => {
    expect(dublettenSchluessel("Müller, Jürgen")).toBe(dublettenSchluessel("jurgen muller"));
    expect(dublettenSchluessel("Groß Peter")).toBe("gross peter");
    expect(dublettenSchluessel("Ayşe Çelik")).toBe(dublettenSchluessel("celik ayse"));
    expect(dublettenSchluessel("A. Meier")).toBe("meier");
  });
  it("gespraecheJeFirma gruppiert, ohne Firma zuletzt, neueste zuerst", () => {
    const k: FirmaKurz = { id: "k", name: "Kottke", marke: "kottke" };
    const c: FirmaKurz = { id: "c", name: "Ceylan", marke: "ceylan" };
    const g = (id: string, firma: FirmaKurz | null, am: string | null): KundenGespraech => ({
      conversationId: id,
      kanal: "whatsapp",
      konto: "x",
      firma,
      letzteNachrichtAm: am,
      dealId: null,
    });
    const r = gespraecheJeFirma([g("1", k, "2026-11-01"), g("2", null, "2026-11-09"), g("3", c, "2026-11-02"), g("4", k, "2026-11-05")]);
    expect(r.map((x) => x.firma?.id ?? null)).toEqual(["c", "k", null]);
    expect(r[1]!.liste.map((x) => x.conversationId)).toEqual(["4", "1"]);
  });
});

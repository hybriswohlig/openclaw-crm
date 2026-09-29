import { describe, expect, it } from "vitest";
import { anredeAus, begruessung, saeubern, stimmeAusSignatur, STIL_REGELN } from "./stimme";

describe("stimmeAusSignatur", () => {
  it("Name / Marke", () => {
    expect(stimmeAusSignatur("Beste Grüße\nDario / Kottke Umzüge")).toEqual({ absender: "Dario", marke: "Kottke Umzüge" });
    expect(stimmeAusSignatur("Beste Grüße\nNuri / Ceylan Umzüge & Transporte")).toEqual({ absender: "Nuri", marke: "Ceylan Umzüge & Transporte" });
  });
  it("Name von Marke (alte Erstkontakt-Signatur)", () => {
    expect(stimmeAusSignatur("Dario von Kottke-Umzügen (Partner der Immobilien Scout GmbH)")).toEqual({ absender: "Dario", marke: "Kottke-Umzügen" });
  });
  it("nur Marke", () => {
    expect(stimmeAusSignatur("Kottke Umzüge")).toEqual({ absender: null, marke: "Kottke Umzüge" });
  });
});

describe("anredeAus", () => {
  const k = (text: string) => ({ eingehend: true, text });
  const w = (text: string) => ({ eingehend: false, text });
  it("ohne Anhaltspunkt: Sie", () => {
    expect(anredeAus([])).toBe("sie");
    expect(anredeAus([k("Umzug am 3.10., 2 Zimmer")])).toBe("sie");
  });
  it("Kunde duzt: du", () => {
    expect(anredeAus([k("Hi, kannst du mir ein Angebot machen?")])).toBe("du");
    expect(anredeAus([k("Könnt ihr am Samstag?")])).toBe("du");
  });
  it("'Ihr' am Satzanfang ist höflich, 'ihr' als dritte Person kein Du (Review Astra/Grok)", () => {
    expect(anredeAus([k("Ihr Angebot ist angekommen, danke.")])).toBe("sie");
    expect(anredeAus([k("Ich helfe ihr beim Einpacken.")])).toBe("sie");
    expect(anredeAus([k("Die Wohnung gehört ihr.")])).toBe("sie");
    expect(anredeAus([k("Ihr könnt am Samstag?")])).toBe("du");
  });
  it("Kunde siezt: Sie", () => {
    expect(anredeAus([k("Können Sie mir ein Angebot schicken?")])).toBe("sie");
  });
  it("Form des Kunden vor unserer, sonst unsere", () => {
    // Kunde zuerst (Owner-Entscheidung): duzt er, duzen wir auch
    expect(anredeAus([w("Guten Tag, können Sie uns Fotos schicken?"), k("klar, hier sind sie. was kostet das bei dir?")])).toBe("du");
    // ohne Signal vom Kunden bleibt unsere Form
    expect(anredeAus([w("Hey, kannst du uns Fotos schicken?"), k("Hier. Was kostet das?")])).toBe("du");
  });
  it("'Sie' am Satzanfang als 'sie (die Kartons)' zählt nicht, wenn sonst nichts dafür spricht", () => {
    expect(anredeAus([k("Die Kartons? Sie sind schon gepackt.")])).toBe("sie");
  });
});

describe("begruessung", () => {
  it("Sie mit und ohne Namen, Du mit Vorname", () => {
    expect(begruessung("sie", { anrede: "Herr", nachname: "Schrade" })).toBe("Guten Tag Herr Schrade,");
    expect(begruessung("sie", {})).toBe("Guten Tag,");
    expect(begruessung("du", { vorname: "Max" })).toBe("Hallo Max,");
    expect(begruessung("du", {})).toBe("Hallo,");
    expect(begruessung("sie", { anrede: "Herrn", nachname: "Gührer" })).toBe("Guten Tag Herr Gührer,");
    expect(begruessung("sie", { anrede: "Fr.", nachname: "Özcan" })).toBe("Guten Tag Frau Özcan,");
  });
});

describe("saeubern", () => {
  it("Gedankenstriche werden Kommas", () => {
    expect(saeubern("Das passt – wir melden uns.")).toBe("Das passt, wir melden uns.");
    expect(saeubern("Das passt — wir melden uns.")).toBe("Das passt, wir melden uns.");
    expect(saeubern("Das passt - wir melden uns.")).toBe("Das passt, wir melden uns.");
  });
  it("Zahlenbereiche bleiben Zahlenbereiche (Review Astra/Grok)", () => {
    expect(saeubern("Wir brauchen 5 - 10 Fotos.")).toBe("Wir brauchen 5 bis 10 Fotos.");
    expect(saeubern("2 – 3 Zimmer, Tel. 030-12345")).toBe("2 bis 3 Zimmer, Tel. 030-12345");
    expect(saeubern("Tel. 030 - 1234567")).toBe("Tel. 030 - 1234567");
    expect(saeubern("Nr. 123 - 4567")).toBe("Nr. 123 - 4567");
    expect(saeubern("12 - 030")).toBe("12 - 030");
  });
  it("Bindestriche in Wörtern und Aufzählungen bleiben", () => {
    expect(saeubern("Ein- und Ausladen, E-Mail\n- Etage\n- Aufzug")).toBe("Ein- und Ausladen, E-Mail\n- Etage\n- Aufzug");
  });
  it("Grußzeilen und Namen am Ende fallen weg (die Signatur wird angehängt)", () => {
    expect(saeubern("Danke für die Bilder.\n\nViele Grüße\nDario", { absender: "Dario", marke: "Kottke Umzüge" })).toBe("Danke für die Bilder.");
    expect(saeubern("Danke.\nBeste Grüße, Nuri von Ceylan Operations", { absender: "Nuri", marke: "Ceylan Umzüge & Transporte" })).toBe("Danke.");
    expect(saeubern("Danke.\nLG")).toBe("Danke.");
    expect(saeubern("Danke.\nMit freundlichen Grüßen\nDario", { absender: "Dario", marke: "Kottke Umzüge" })).toBe("Danke.");
  });
  it("Inhaltszeilen am Ende bleiben stehen (Review Astra/Grok)", () => {
    const st = { absender: "Dario", marke: "Kottke Umzüge" };
    expect(saeubern("Danke.\nDario prüft noch die Zufahrt.", st)).toBe("Danke.\nDario prüft noch die Zufahrt.");
    expect(saeubern("Viele Grüße, der Termin passt so.", st)).toBe("Viele Grüße, der Termin passt so.");
    expect(saeubern("Danke.\nLG anbei die Fotos")).toBe("Danke.\nLG anbei die Fotos");
    expect(saeubern("Danke.\nDario von der Disposition schaut morgen", st)).toBe("Danke.\nDario von der Disposition schaut morgen");
    expect(saeubern("Danke.\nDario von Kottke-Umzügen", st)).toBe("Danke.");
    expect(saeubern("Danke.\nDario / Kottke Umzüge", st)).toBe("Danke.");
    expect(saeubern("Danke.\nDario von dem Umzug weiß Bescheid", st)).toBe("Danke.\nDario von dem Umzug weiß Bescheid");
    expect(saeubern("Danke.\nDario / schaut morgen vorbei", st)).toBe("Danke.\nDario / schaut morgen vorbei");
    expect(saeubern("Danke.\nBeste Grüße, Nuri von Ceylan Operations", { absender: "Nuri", marke: "Ceylan Umzüge & Transporte" })).toBe("Danke.");
  });
  it("mehrere Leerzeilen werden eine", () => {
    expect(saeubern("A\n\n\n\nB")).toBe("A\n\nB");
  });
});

describe("STIL_REGELN", () => {
  it("enthält die Kernregeln und keine Gedankenstriche", () => {
    expect(STIL_REGELN).toMatch(/Wir-Form/);
    expect(STIL_REGELN).toMatch(/Wiederhole keine Kundendaten/);
    expect(STIL_REGELN).toMatch(/ohne Zeitangabe/);
    expect(STIL_REGELN).not.toMatch(/[–—]/);
  });
});

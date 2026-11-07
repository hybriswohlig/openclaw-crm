import { describe, expect, it } from "vitest";
import { akteZurueckZiel, LEADS_LINK } from "./akte-zurueck-logik";

const O = "https://crm.test";
const basis = { jetzt: `${O}/app/leads/d1`, ersteAdresse: `${O}/app/leads/d1`, referrer: "", origin: O, verlaufLaenge: 2 };

describe("akteZurueckZiel", () => {
  it("Direktaufruf ohne Vorgänger: zur Liste", () => {
    expect(akteZurueckZiel({ ...basis, verlaufLaenge: 1 })).toEqual({ art: "link", href: LEADS_LINK });
    expect(akteZurueckZiel(basis)).toEqual({ art: "link", href: "/app/leads" });
  });

  it("innerhalb der App hierher navigiert: zurück", () => {
    expect(akteZurueckZiel({ ...basis, ersteAdresse: `${O}/app/leads` })).toEqual({ art: "zurueck" });
    expect(akteZurueckZiel({ ...basis, ersteAdresse: `${O}/app/inbox?e=deal%3Ad1` })).toEqual({ art: "zurueck" });
  });

  it("nur ein anderer Anker zählt nicht als Navigation", () => {
    expect(akteZurueckZiel({ ...basis, jetzt: `${O}/app/leads/d1#x` })).toEqual({ art: "link", href: LEADS_LINK });
  });

  it("per Link aus der neuen Oberfläche geladen: zurück", () => {
    expect(akteZurueckZiel({ ...basis, referrer: `${O}/app/plan` })).toEqual({ art: "zurueck" });
  });

  it("Referrer von alter Seite, fremdem Host oder kaputt: zur Liste", () => {
    expect(akteZurueckZiel({ ...basis, referrer: `${O}/objects/deals/d1` })).toEqual({ art: "link", href: LEADS_LINK });
    expect(akteZurueckZiel({ ...basis, referrer: "https://google.com/app/x" })).toEqual({ art: "link", href: LEADS_LINK });
    expect(akteZurueckZiel({ ...basis, referrer: "::" })).toEqual({ art: "link", href: LEADS_LINK });
  });

  it("ohne Verlauf hilft auch ein Referrer nicht", () => {
    expect(akteZurueckZiel({ ...basis, verlaufLaenge: 1, referrer: `${O}/app/plan`, ersteAdresse: `${O}/app/plan` })).toEqual({
      art: "link",
      href: LEADS_LINK,
    });
  });

  it("ohne erste Adresse entscheidet der Referrer", () => {
    expect(akteZurueckZiel({ ...basis, ersteAdresse: null })).toEqual({ art: "link", href: LEADS_LINK });
    expect(akteZurueckZiel({ ...basis, ersteAdresse: null, referrer: `${O}/app/leads` })).toEqual({ art: "zurueck" });
  });
});

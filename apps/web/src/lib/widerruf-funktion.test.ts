import { describe, expect, it } from "vitest";
import {
  annahmeRegeln,
  widerrufModus,
  widerrufsbelehrung,
  firmaKontakt,
  widerrufsfristEnde,
  widerrufsfunktionAktiv,
  parseWiderrufPayload,
  BUTTON_VERTRAG_WIDERRUFEN,
  BUTTON_WIDERRUF_BESTAETIGEN,
} from "@openclaw-crm/customer-portal-core";

const now = new Date("2026-10-06T10:00:00+02:00");

describe("Entrümpelung als eigene Leistungsart", () => {
  it("Entrümpelung: Widerrufsbelehrung statt Ausschluss", () => {
    expect(widerrufModus("clearance")).toBe("belehrung");
  });
  it("kein § 451g-Hinweis, Termin nicht Pflicht", () => {
    const r = annahmeRegeln({ serviceType: "clearance", moveDate: null, hasOpenDateChoice: false, now });
    expect(r.haftungshinweisErforderlich).toBe(false);
    expect(r.terminFehlt).toBe(false);
    expect(r.vorzeitigerBeginnErforderlich).toBe(false);
  });
  it("Termin in 5 Tagen: vorzeitiger Beginn nötig", () => {
    const r = annahmeRegeln({ serviceType: "clearance", moveDate: "2026-10-11", hasOpenDateChoice: false, now });
    expect(r.vorzeitigerBeginnErforderlich).toBe(true);
  });
});

describe("widerrufsfristEnde (§§ 187, 188, 193 BGB, Feiertage BW)", () => {
  it("Dienstag + 14 Tage = Dienstag", () => {
    expect(widerrufsfristEnde(new Date("2026-10-06T10:00:00+02:00"))).toBe("2026-10-20");
  });
  it("zählt nach dem Kalendertag in Berlin, nicht nach UTC", () => {
    expect(widerrufsfristEnde(new Date("2026-10-06T23:30:00+02:00"))).toBe("2026-10-20");
    expect(widerrufsfristEnde(new Date("2026-10-06T22:30:00Z"))).toBe("2026-10-21");
  });
  it("Ende am Samstag verschiebt auf Montag", () => {
    expect(widerrufsfristEnde(new Date("2026-10-03T12:00:00+02:00"))).toBe("2026-10-19");
  });
  it("Weihnachten und Wochenende: weiter bis zum nächsten Werktag", () => {
    expect(widerrufsfristEnde(new Date("2026-12-11T12:00:00+01:00"))).toBe("2026-12-28");
  });
  it("Karfreitag bis Ostermontag 2027", () => {
    expect(widerrufsfristEnde(new Date("2027-03-12T12:00:00+01:00"))).toBe("2027-03-30");
  });
  it("Fronleichnam (nur in BW und einigen Ländern) 2027", () => {
    // Ostern 2027 = 28.03., Fronleichnam = 27.05. (Donnerstag)
    expect(widerrufsfristEnde(new Date("2027-05-13T12:00:00+02:00"))).toBe("2027-05-28");
  });
});

describe("widerrufsfunktionAktiv", () => {
  const signedAt = new Date("2026-10-06T10:00:00+02:00");
  it("bei Belehrung während der Frist sichtbar, auch am letzten Tag spät abends", () => {
    expect(widerrufsfunktionAktiv({ widerrufModus: "belehrung", signedAt, now: new Date("2026-10-07T09:00:00+02:00") })).toBe(true);
    expect(widerrufsfunktionAktiv({ widerrufModus: "belehrung", signedAt, now: new Date("2026-10-20T23:59:00+02:00") })).toBe(true);
  });
  it("nach Fristende nicht mehr", () => {
    expect(widerrufsfunktionAktiv({ widerrufModus: "belehrung", signedAt, now: new Date("2026-10-21T00:01:00+02:00") })).toBe(false);
  });
  it("Umzug ohne Widerrufsrecht und Altbestand: nie", () => {
    expect(widerrufsfunktionAktiv({ widerrufModus: "ausgeschlossen", signedAt, now })).toBe(false);
    expect(widerrufsfunktionAktiv({ widerrufModus: null, signedAt, now })).toBe(false);
  });
});

describe("parseWiderrufPayload (§ 356a Abs. 2 BGB)", () => {
  it("Name und bekannter Kanal", () => {
    expect(parseWiderrufPayload({ name: "  Anna Muster ", kanal: "whatsapp" })).toEqual({ name: "Anna Muster", kanal: "whatsapp", email: null });
    expect(parseWiderrufPayload({ name: "Anna Muster", kanal: "email" })).toEqual({ name: "Anna Muster", kanal: "email", email: null });
  });
  it("neue E-Mail-Adresse nur mit gültiger Adresse", () => {
    expect(parseWiderrufPayload({ name: "Anna Muster", kanal: "email_neu", email: " anna@example.de " })).toEqual({ name: "Anna Muster", kanal: "email_neu", email: "anna@example.de" });
    expect(parseWiderrufPayload({ name: "Anna Muster", kanal: "email_neu", email: "anna" })).toBeNull();
  });
  it("ohne Namen, mit unbekanntem Kanal oder kein Objekt: null", () => {
    expect(parseWiderrufPayload({ name: " ", kanal: "email" })).toBeNull();
    expect(parseWiderrufPayload({ name: "Anna", kanal: "fax" })).toBeNull();
    expect(parseWiderrufPayload(null)).toBeNull();
    expect(parseWiderrufPayload(["x"])).toBeNull();
  });
});

describe("Beschriftungen und Belehrung", () => {
  it("Schaltflächen wörtlich nach § 356a Abs. 1 und 3 BGB", () => {
    expect(BUTTON_VERTRAG_WIDERRUFEN).toBe("Vertrag widerrufen");
    expect(BUTTON_WIDERRUF_BESTAETIGEN).toBe("Widerruf bestätigen");
  });
  it("Belehrung nennt die Online-Funktion (Gestaltungshinweis 3) und den Ort", () => {
    const text = widerrufsbelehrung(firmaKontakt("kottke")).absaetze.join(" ");
    expect(text).toContain("Sie können Ihr Widerrufsrecht auch online");
    expect(text).toContain("„Vertrag widerrufen“");
    expect(text).toContain("Eingangsbestätigung mit Informationen zum Inhalt der Widerrufserklärung sowie dem Datum und der Uhrzeit ihres Eingangs");
  });
  it("mit Portal-Link steht die Adresse in der Belehrung", () => {
    const text = widerrufsbelehrung(firmaKontakt("kottke"), { portalUrl: "https://portal.example/s/abc" }).absaetze.join(" ");
    expect(text).toContain("https://portal.example/s/abc");
  });
});

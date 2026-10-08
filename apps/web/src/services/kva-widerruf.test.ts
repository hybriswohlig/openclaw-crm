import { describe, expect, it } from "vitest";
import {
  bestaetigungFehlgeschlagenText,
  bestaetigungsWege,
  eingangsbestaetigungText,
  kanalVerfuegbar,
  leistungLabel,
  teamAlarmWiderrufText,
  widerrufVertragText,
} from "./kva-widerruf";

const eingegangenAt = new Date("2026-10-08T16:42:00Z"); // 18:42 Uhr in Berlin

describe("widerrufVertragText (§ 356a Abs. 2 Nr. 2 BGB)", () => {
  it("nennt Auftrag, Leistung und Tag der Annahme", () => {
    expect(widerrufVertragText({ dealNumber: "K-1042", serviceType: "clearance", signedAt: new Date("2026-10-06T08:00:00Z") }))
      .toBe("Auftrag K-1042, Entrümpelung, angenommen am 6. Oktober 2026");
  });
  it("Leistungsarten auf Deutsch", () => {
    expect(leistungLabel("move")).toBe("Umzug");
    expect(leistungLabel("kitchen_installation")).toBe("Küchenmontage");
    expect(leistungLabel("clearance")).toBe("Entrümpelung");
    expect(leistungLabel(null)).toBe("Auftrag");
  });
});

describe("eingangsbestaetigungText (§ 356a Abs. 4 BGB)", () => {
  const t = eingangsbestaetigungText({
    firma: "Kottke Dienstleistungen",
    name: "Anna Muster",
    vertrag: "Auftrag K-1042, Entrümpelung, angenommen am 6. Oktober 2026",
    kanalText: "per E-Mail an anna@example.de",
    eingegangenAt,
  });
  it("enthält die Erklärung mit Name, Vertrag und Kanal", () => {
    expect(t).toContain("Hiermit widerrufe ich den Vertrag");
    expect(t).toContain("Name: Anna Muster");
    expect(t).toContain("Vertrag: Auftrag K-1042, Entrümpelung, angenommen am 6. Oktober 2026");
    expect(t).toContain("Eingangsbestätigung per E-Mail an anna@example.de");
  });
  it("nennt Datum und Uhrzeit des Eingangs in Berliner Zeit", () => {
    expect(t).toContain("8. Oktober 2026 um 18:42 Uhr");
  });
  it("ohne Gedankenstriche", () => {
    expect(t).not.toMatch(/[—–]/);
  });
});

describe("teamAlarmWiderrufText", () => {
  it("nennt Auftrag, Kunde, Betrag, Rückzahlung und bei vorzeitigem Beginn den Wertersatz", () => {
    const t = teamAlarmWiderrufText({ dealNumber: "K-1042", name: "Anna Muster", eingegangenAt, preisCents: 89000, vorzeitigerBeginn: true });
    expect(t).toContain("Widerruf");
    expect(t).toContain("K-1042");
    expect(t).toContain("Anna Muster");
    expect(t).toContain("890,00");
    expect(t).toContain("Rückzahlung");
    expect(t).toContain("Wertersatz");
  });
  it("ohne vorzeitigen Beginn kein Wertersatz", () => {
    const t = teamAlarmWiderrufText({ dealNumber: "K-1042", name: "Anna Muster", eingegangenAt, preisCents: 89000, vorzeitigerBeginn: false });
    expect(t).not.toContain("Wertersatz");
  });
});

describe("bestaetigungFehlgeschlagenText", () => {
  it("sagt, dass die Eingangsbestätigung von Hand raus muss, und wohin", () => {
    const t = bestaetigungFehlgeschlagenText({ dealNumber: "K-1042", name: "Anna Muster", ziel: "anna@example.de" });
    expect(t).toContain("Eingangsbestätigung");
    expect(t).toContain("ging nicht raus");
    expect(t).toContain("anna@example.de");
    expect(t).toContain("K-1042");
  });
});

describe("bestaetigungsWege", () => {
  it("WhatsApp gewählt: erst WhatsApp, dann die bekannte E-Mail als Ersatz", () => {
    expect(bestaetigungsWege({ kanal: "whatsapp", email: null, bekannteEmail: "a@x.de" })).toEqual([{ art: "whatsapp" }, { art: "email", an: "a@x.de" }]);
    expect(bestaetigungsWege({ kanal: "whatsapp", email: null, bekannteEmail: null })).toEqual([{ art: "whatsapp" }]);
  });
  it("E-Mail gewählt: genau diese Adresse", () => {
    expect(bestaetigungsWege({ kanal: "email", email: "a@x.de", bekannteEmail: "a@x.de" })).toEqual([{ art: "email", an: "a@x.de" }]);
    expect(bestaetigungsWege({ kanal: "email_neu", email: "neu@x.de", bekannteEmail: "a@x.de" })).toEqual([{ art: "email", an: "neu@x.de" }]);
  });
  it("E-Mail ohne Adresse: kein Weg", () => {
    expect(bestaetigungsWege({ kanal: "email", email: null, bekannteEmail: null })).toEqual([]);
  });
});

describe("kanalVerfuegbar", () => {
  it("bekannte E-Mail und WhatsApp nur, wenn vorhanden; neue E-Mail immer", () => {
    expect(kanalVerfuegbar("email", { emailBekannt: true, whatsapp: false })).toBe(true);
    expect(kanalVerfuegbar("email", { emailBekannt: false, whatsapp: true })).toBe(false);
    expect(kanalVerfuegbar("whatsapp", { emailBekannt: true, whatsapp: false })).toBe(false);
    expect(kanalVerfuegbar("whatsapp", { emailBekannt: false, whatsapp: true })).toBe(true);
    expect(kanalVerfuegbar("email_neu", { emailBekannt: false, whatsapp: false })).toBe(true);
  });
});

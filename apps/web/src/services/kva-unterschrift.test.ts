import { describe, expect, it } from "vitest";
import { pngAusDataUrl, teamHinweisUnterschrift, vertragMailText, vertragNachrichtWhatsApp, widerrufHinweisFuerMappe } from "./kva-unterschrift";

const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("pngAusDataUrl", () => {
  it("liefert die Bytes eines PNG", () => {
    const bytes = pngAusDataUrl(`data:image/png;base64,${PNG_1PX}`);
    expect(bytes).not.toBeNull();
    expect(Array.from(bytes!.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
  it("lehnt riesige Abmessungen und PNG ohne IHDR ab", () => {
    const kopf = (w: number, h: number) => {
      const b = Buffer.alloc(33);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
      b.writeUInt32BE(13, 8);
      b.write("IHDR", 12, "ascii");
      b.writeUInt32BE(w, 16);
      b.writeUInt32BE(h, 20);
      return `data:image/png;base64,${b.toString("base64")}`;
    };
    expect(pngAusDataUrl(kopf(20000, 20000))).toBeNull();
    expect(pngAusDataUrl(kopf(5000, 300))).toBeNull();
    expect(pngAusDataUrl(kopf(1380, 540))).not.toBeNull();
    expect(pngAusDataUrl(`data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64")}`)).toBeNull();
  });
  it("lehnt falsches Präfix, kaputtes Base64 und Nicht-PNG ab", () => {
    expect(pngAusDataUrl(`data:image/jpeg;base64,${PNG_1PX}`)).toBeNull();
    expect(pngAusDataUrl("data:image/png;base64,%%%")).toBeNull();
    expect(pngAusDataUrl(`data:image/png;base64,${Buffer.from("kein png").toString("base64")}`)).toBeNull();
  });
});

describe("widerrufHinweisFuerMappe", () => {
  it("Umzug ohne Widerruf nutzt den Core-Text, Belehrung mit vorzeitigem Beginn, Altbestand ohne Zeile", () => {
    expect(widerrufHinweisFuerMappe("ausgeschlossen", false)).toContain("kein gesetzliches Widerrufsrecht");
    const b = widerrufHinweisFuerMappe("belehrung", true)!;
    expect(b).toContain("Widerrufsbelehrung");
    expect(b).toContain("vor Ablauf der Widerrufsfrist");
    expect(widerrufHinweisFuerMappe("belehrung", false)).not.toContain("vor Ablauf");
    expect(widerrufHinweisFuerMappe(null, false)).toBeNull();
  });
});

describe("Texte", () => {
  const d = { firma: "Kottke Dienstleistungen", kunde: "Anna Muster", dealNumber: "K-1042", portalUrl: "https://status.example/s/abc" };
  it("WhatsApp nennt Vorname, Auftrag und Portal-Link, ohne Gedankenstriche", () => {
    const t = vertragNachrichtWhatsApp(d);
    expect(t).toContain("Hallo Anna,");
    expect(t).toContain("K-1042");
    expect(t).toContain(d.portalUrl);
    expect(t).not.toMatch(/[—–]/);
  });
  it("Mail ohne Anhang verspricht keinen Anhang", () => {
    const ohne = vertragMailText({ ...d, unterschriftAm: new Date("2026-10-22T08:20:00Z"), pdfDabei: false });
    expect(ohne).not.toContain("Im Anhang");
    expect(ohne).toContain("in Ihrem Kundenportal herunterladen");
    expect(vertragMailText({ ...d, unterschriftAm: new Date("2026-10-22T08:20:00Z"), pdfDabei: true })).toContain("Im Anhang finden Sie");
  });
  it("Mail nennt Datum und Uhrzeit der Unterschrift in Berliner Zeit", () => {
    const t = vertragMailText({ ...d, unterschriftAm: new Date("2026-10-22T08:20:00Z"), pdfDabei: true });
    expect(t).toContain("Guten Tag Anna Muster,");
    expect(t).toContain("22. Oktober 2026");
    expect(t).toContain("10:20 Uhr");
  });
  it("Teamhinweis kurz und vollständig, mit Warnung bei gescheitertem Versand", () => {
    expect(teamHinweisUnterschrift({ dealNumber: "K-1042", name: "Anna Muster", at: new Date("2026-10-22T08:20:00Z"), versandOk: true }))
      .toBe("Vertrag unterschrieben: Auftrag K-1042, Anna Muster, 22.10.2026 10:20 Uhr.");
    expect(teamHinweisUnterschrift({ dealNumber: "K-1042", name: "Anna Muster", at: new Date("2026-10-22T08:20:00Z"), versandOk: false }))
      .toContain("Achtung: Der Vertrag ging nicht an den Kunden.");
  });
});

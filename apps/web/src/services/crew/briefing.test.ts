import { describe, expect, it } from "vitest";
import { briefingNachricht, briefingTag, briefingUrl } from "@/lib/crew/briefing-nachricht";
import { CREW_LOCALES } from "@/lib/crew/contract";
import { betragCent, stoppsAus, teamAus, zahlungFuer, zahlungsArt } from "./briefing";

describe("Briefing: reine Logik", () => {
  it("Zahlungsart aus dem Optionstitel", () => {
    expect(zahlungsArt("Bar")).toBe("bar");
    expect(zahlungsArt("Überweisung")).toBe("ueberweisung");
    expect(zahlungsArt("Bereits bezahlt")).toBe("bezahlt");
    expect(zahlungsArt("PayPal")).toBeNull();
    expect(zahlungsArt(null)).toBeNull();
  });

  it("Betrag aus dem Währungsfeld in Cent, 0 und Unsinn → null", () => {
    expect(betragCent({ j: { amount: 700, currencyCode: "EUR" } })).toBe(70000);
    expect(betragCent({ j: '{"amount": 80.5}' })).toBe(8050);
    expect(betragCent({ j: { amount: 0 } })).toBeNull();
    expect(betragCent({ j: { amount: "x" } })).toBeNull();
    expect(betragCent(undefined)).toBeNull();
  });

  it("Barzahlung nur für die Teamleitung, ohne Teamleitung für alle; Betrag nur bei bar", () => {
    const bar = { payment_method: { o: "Bar" }, amount_outstanding: { j: { amount: 1240 } } };
    expect(zahlungFuer(bar, true, true)).toEqual({ kind: "bar", amountCents: 124000 });
    expect(zahlungFuer(bar, false, true)).toBeNull();
    expect(zahlungFuer(bar, false, false)).toEqual({ kind: "bar", amountCents: 124000 });
    expect(zahlungFuer({ payment_method: { o: "Überweisung" }, amount_outstanding: { j: { amount: 9 } } }, true, true)).toEqual({
      kind: "ueberweisung",
      amountCents: null,
    });
    expect(zahlungFuer({}, true, true)).toBeNull();
  });

  it("Stopps: Adresse mit Etage, Zugang, Laufweg, Halteverbot und Kontakt; ohne Zieladresse nur einer", () => {
    const dw = {
      move_from_address: { j: { line1: "Hauptstraße 5", postcode: "70176", city: "Stuttgart" } },
      floors_from: { n: 2 },
      elevator_from: { o: "Treppe" },
    };
    const aw = {
      stairwell_from: { o: "Eng" },
      walking_distance_from_m: { n: "25.4" },
      parking_halteverbot_needed: { b: true },
      contact_pickup_name: { t: "Matthias" },
      contact_pickup_phone: { t: " 0151 160 " },
      parking_halteverbot_to: { b: true },
    };
    expect(stoppsAus(dw, aw)).toEqual([
      {
        kind: "from",
        address: "Hauptstraße 5, 70176 Stuttgart",
        floor: 2,
        access: "Treppe",
        stairwell: "Eng",
        walkM: 25,
        halteverbot: true,
        contact: { name: "Matthias", phone: "0151 160" },
      },
    ]);
    const ziel = stoppsAus({ ...dw, move_to_address: { t: "Rosenweg 3, Tübingen" } }, {});
    expect(ziel.map((s) => [s.kind, s.address, s.contact])).toEqual([
      ["from", "Hauptstraße 5, 70176 Stuttgart", null],
      ["to", "Rosenweg 3, Tübingen", null],
    ]);
  });

  it("Team: Vorname, Rolle, Telefon, ich markiert", () => {
    const t = teamAus(
      [
        { id: "e1", role: "lead", name: "Ali Kaya", phone: "+4915100" },
        { id: "e2", role: "helper", name: null, phone: null },
      ],
      "e2",
    );
    expect(t.map((m) => [m.firstName, m.role, m.phone, m.me])).toEqual([
      ["Ali", "lead", "+4915100", false],
      ["?", "helper", null, true],
    ]);
  });

  it("WhatsApp-Text: Vorname, Tag in der Sprache, Link mit Briefing; nie Firmennamen", () => {
    const url = briefingUrl("https://crew.example/l/" + "A".repeat(32), "deal 1");
    expect(url).toBe("https://crew.example/l/" + "A".repeat(32) + "?b=deal%201");
    const de = briefingNachricht("de", "Mehmet Ali Yilmaz", "2026-11-19", url);
    expect(de).toContain("Hallo Mehmet!");
    expect(de).toContain("Do., 19.11.");
    expect(de).toContain(url);
    for (const l of CREW_LOCALES) {
      const t = briefingNachricht(l, "Ana", "2026-11-19", url);
      expect(t, l).toContain(url);
      expect(t, l).not.toMatch(/Kottke|Rümpeltürken|Ceylan|Büro/i);
    }
    expect(briefingTag("de", null)).toBe("deinen Einsatz");
    expect(briefingTag("en", "kaputt")).toBe("your job");
  });
});

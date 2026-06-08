import { describe, expect, it } from "vitest";
import {
  isImmoscoutEmail,
  isImmoscoutLeadEmail,
  parseImmoscoutLeadEmail,
} from "./inbox-immoscout";

// Real IS24 "Umzugsanfrage" body (stripped plain text as stored in inbox_messages.body).
const GERRIT_BODY = `
[ImmoScout24](https://www.immobilienscout24.de/)
Die Nr. 1 für Immobilien

# Neue Basis Anfrage

Sehr geehrter Partner,

folgende Anfrage ist soeben für Sie eingegangen:

Anfrage #95744021260604094746 vom 04.06.2026 um 11:47.

============================================
PRIVATUMZUG
============================================

-------------------------------------------------------------------------------
Kontaktdaten
-------------------------------------------------------------------------------
  Name:  Gerrit Ermert
  Telefon: +49 1514 6307327
  E-Mail: gerritermert@gmail.com
  Abrechnung über: Privat

-------------------------------------------------------------------------------
Auszug
-------------------------------------------------------------------------------
  ab: 01.09.2026
  Straße: Alte Stuttgarter Straße
  PLZ / Ort: DE-71106 Magstadt
  Gebäude: MFH
  Trageweg (Straße/Hauseingang): Nicht bekannt
  Etage: 1
  Zimmer: 1-2
  Anzahl Personen: 1
  Fläche: 50 m&sup2;
  Einpacken: Nein
  Möbel Abbau: Ja
  Küche Abbau: Nein
  Halteverbot beantragen: Nein
  Keller: Nein
  Dachboden: Nein
  Balkon: Nein
  Terrasse: Nein
  Umzugskartons benötigt: Nein
  Verpackungsmaterial benötigt: Nein
  Elektroarbeiten: Nein
  Entsorgung: Nein
  Aufzug im Haus: Nein

-------------------------------------------------------------------------------
Einzug
-------------------------------------------------------------------------------
  ab: 01.09.2026
  Straße: keine Straße angegeben
  PLZ / Ort: DE-74354 Besigheim
  Gebäude: MFH
  Trageweg (Straße/Hauseingang): Nicht bekannt
  Etage: 3
  Auspacken: Nein
  Möbel Aufbau: Ja
  Küche Aufbau: Nein
  Möbel einlagern: Nein
  Halteverbot beantragen: Nein
  Aufzug im Haus: Ja, kleiner Aufzug (bis zu 8 Personen)

-------------------------------------------------------------------------------
Details zur Anfrage
-------------------------------------------------------------------------------
Entfernung vom Auszugsort zum Einzugsort: 41,62 km
`;

describe("isImmoscoutEmail / isImmoscoutLeadEmail", () => {
  it("detects the IS24 platform sender", () => {
    expect(isImmoscoutEmail("noreply@immobilienscout24.de")).toBe(true);
    expect(isImmoscoutEmail("Noreply@ImmobilienScout24.DE")).toBe(true);
    expect(isImmoscoutEmail("kunde@gmail.com")).toBe(false);
  });

  it("only treats 'IS24 Umzugsanfrage' subjects as leads", () => {
    expect(
      isImmoscoutLeadEmail(
        "noreply@immobilienscout24.de",
        "IS24 Umzugsanfrage: ID 95744021260604094746 / Gerrit Ermert"
      )
    ).toBe(true);
    // Marketing / notification noise is NOT a lead.
    expect(
      isImmoscoutLeadEmail("noreply@immobilienscout24.de", "Neue Angebote im AnfragenShop")
    ).toBe(false);
    expect(
      isImmoscoutLeadEmail("kunde@gmail.com", "IS24 Umzugsanfrage: ID 1 / X")
    ).toBe(false);
  });
});

describe("parseImmoscoutLeadEmail", () => {
  const r = parseImmoscoutLeadEmail(GERRIT_BODY)!;

  it("returns a result", () => {
    expect(r).not.toBeNull();
  });

  it("extracts the shared IS24 request id (= externalId for dedup)", () => {
    expect(r.externalId).toBe("95744021260604094746");
    expect(r.payload.externalId).toBe("95744021260604094746");
    expect(r.payload.importId).toBe("95744021260604094746");
    expect(r.payload.source).toBe("immoscout24");
    expect(r.payload.channel).toBe("email");
  });

  it("extracts the customer identity from the body (not the noreply sender)", () => {
    expect(r.customer.fullName).toBe("Gerrit Ermert");
    expect(r.customer.firstName).toBe("Gerrit");
    expect(r.customer.lastName).toBe("Ermert");
    expect(r.customer.email).toBe("gerritermert@gmail.com");
    expect(r.customer.phone).toBe("+49 1514 6307327");
  });

  it("parses both addresses and the move date", () => {
    const from = r.payload.from as Record<string, unknown>;
    const to = r.payload.to as Record<string, unknown>;
    expect(from.zip).toBe("71106");
    expect(from.city).toBe("Magstadt");
    expect(from.country).toBe("DE");
    expect(from.street).toBe("Alte Stuttgarter Straße");
    expect(from.livingSpace).toBe(50);
    expect(from.elevator).toBe(false);
    expect(to.zip).toBe("74354");
    expect(to.city).toBe("Besigheim");
    expect(to.street).toBe(""); // "keine Straße angegeben"
    expect(to.elevator).toBe(true);
    expect((r.payload.dates as Record<string, unknown>).desiredFrom).toBe("2026-09-01");
    expect(r.dealNameParts.fromCity).toBe("Magstadt");
    expect(r.dealNameParts.toCity).toBe("Besigheim");
    expect(r.dealNameParts.moveDate).toBe("2026-09-01");
  });

  it("maps services and distance and payment", () => {
    const s = r.payload.services as Record<string, boolean>;
    expect(s.furnitureDismantling).toBe(true); // Möbel Abbau: Ja
    expect(s.furnitureReassembly).toBe(true); // Möbel Aufbau: Ja
    expect(s.packing).toBe(false); // Einpacken: Nein
    expect(r.payload.distance).toBe(41.62);
    expect(r.payload.payment).toBe("bez_priv");
    expect(r.payload.category).toBe("PRIVATUMZUG");
  });

  it("builds human-readable inventory notes", () => {
    expect(r.inventoryNotes).toContain("Von: Alte Stuttgarter Straße, 71106 Magstadt");
    expect(r.inventoryNotes).toContain("Nach: 74354 Besigheim");
    expect(r.inventoryNotes).toContain("Entfernung: 41.62 km");
    expect(r.inventoryNotes).toContain("Wohnfläche: 50 m²");
  });

  it("returns null for non-lead bodies", () => {
    expect(parseImmoscoutLeadEmail("")).toBeNull();
    expect(parseImmoscoutLeadEmail("Neue Angebote im AnfragenShop, jetzt ansehen!")).toBeNull();
  });
});

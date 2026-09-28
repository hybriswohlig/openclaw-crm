import { describe, expect, it } from "vitest";
import { interneNummernAus, findeInterne, nurZiffern } from "./interne-nummern";

const liste = interneNummernAus(
  JSON.stringify([
    { name: "Dario", nummer: "+65 8891 3364" },
    { name: "Ceylan", nummer: "+49 176 70722968", lids: ["123456789012345@lid"] },
  ])
);

describe("interneNummernAus", () => {
  it("liest Namen und Nummern, normalisiert auf Ziffern", () => {
    expect(liste).toEqual([
      { name: "Dario", ziffern: "6588913364", lids: [] },
      { name: "Ceylan", ziffern: "4917670722968", lids: ["123456789012345"] },
    ]);
  });
  it("kaputte oder leere Einstellung: leere Liste, kein Fehler", () => {
    expect(interneNummernAus(null)).toEqual([]);
    expect(interneNummernAus("kein json")).toEqual([]);
    expect(interneNummernAus(JSON.stringify([{ name: "x" }, { nummer: "12" }]))).toEqual([]);
  });
});

describe("findeInterne", () => {
  it("erkennt die Nummer als wa-id, als JID und mit Plus", () => {
    expect(findeInterne(liste, { peerWaId: "6588913364" })?.name).toBe("Dario");
    expect(findeInterne(liste, { peerWaId: "x", peerJid: "4917670722968@s.whatsapp.net" })?.name).toBe("Ceylan");
  });
  it("Schreibweisen: 0049, nationale 0176 und Geräte-Endung (Review Grok)", () => {
    const l = interneNummernAus(JSON.stringify([{ name: "C", nummer: "0176 70722968", lids: ["123456789012345:0@lid"] }]));
    expect(l).toEqual([{ name: "C", ziffern: "4917670722968", lids: ["123456789012345"] }]);
    expect(findeInterne(l, { peerWaId: "4917670722968", peerJid: "4917670722968:12@s.whatsapp.net" })?.name).toBe("C");
    expect(interneNummernAus(JSON.stringify([{ name: "D", nummer: "0065 8891 3364" }]))[0]!.ziffern).toBe("6588913364");
  });
  it("Geräte-Endung an einer Telefonnummer ohne @ (Review Grok, Runde 2)", () => {
    const l = interneNummernAus(JSON.stringify([{ name: "C", nummer: "4917670722968:12" }]));
    expect(l[0]?.ziffern).toBe("4917670722968");
    expect(findeInterne(liste, { peerWaId: "4917670722968:12" })?.name).toBe("Ceylan");
    expect(findeInterne(liste, { peerWaId: "x", peerJid: "4917670722968:12@s.whatsapp.net" })?.name).toBe("Ceylan");
  });
  it("reine LID ohne hinterlegte LID bleibt unbekannt (wird normaler Kontakt), statt falsch zu treffen", () => {
    const l = interneNummernAus(JSON.stringify([{ name: "D", nummer: "+6588913364" }]));
    expect(findeInterne(l, { peerWaId: "6588913364", peerJid: "6588913364@lid", peerLid: "6588913364@lid" })).toBeNull();
  });
  it("eine Kunden-LID, deren Ziffern zufällig einer internen Nummer gleichen, trifft nicht (Kundennachricht darf nie verschluckt werden)", () => {
    expect(findeInterne(liste, { peerWaId: "4915111111111", peerLid: "6588913364@lid" })).toBeNull();
  });
  it("erkennt eine hinterlegte LID", () => {
    expect(findeInterne(liste, { peerWaId: "123456789012345", peerLid: "123456789012345@lid" })?.name).toBe("Ceylan");
  });
  it("fremde Nummern sind nicht intern", () => {
    expect(findeInterne(liste, { peerWaId: "4915159058963" })).toBeNull();
    expect(findeInterne([], { peerWaId: "6588913364" })).toBeNull();
  });
  it("nurZiffern", () => {
    expect(nurZiffern("+49 (176) 707-22968")).toBe("4917670722968");
  });
});

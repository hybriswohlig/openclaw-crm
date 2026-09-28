import { describe, expect, it } from "vitest";
import { befehlAus, freigabeCode } from "./freigabe-befehle";

describe("befehlAus", () => {
  it("ok / ja nur mit Code", () => {
    expect(befehlAus("OK A7F2")).toEqual({ aktion: "ok", code: "A7F2" });
    expect(befehlAus("  ja #a7f2 ")).toEqual({ aktion: "ok", code: "A7F2" });
  });
  it("nein / verwerfen nur mit Code", () => {
    expect(befehlAus("Nein A1B2")).toEqual({ aktion: "nein", code: "A1B2" });
    expect(befehlAus("verwerfen a1b2")).toEqual({ aktion: "nein", code: "A1B2" });
  });
  it("ändern nur mit Code, Doppelpunkt und Text, auch mehrzeilig", () => {
    expect(befehlAus("ändern A7F2: Guten Tag Herr Schrade,\ndanke!")).toEqual({
      aktion: "aendern", code: "A7F2", text: "Guten Tag Herr Schrade,\ndanke!",
    });
    expect(befehlAus("Aendern #a7f2: Hallo")).toEqual({ aktion: "aendern", code: "A7F2", text: "Hallo" });
  });
  it("ohne Code ist nichts ein Befehl (Antwort auf einen Alarm darf nie senden, Review Grok)", () => {
    expect(befehlAus("ok")).toBeNull();
    expect(befehlAus("Ja!")).toBeNull();
    expect(befehlAus("nein")).toBeNull();
    expect(befehlAus("ändern: Hallo")).toBeNull();
  });
  it("ändern ohne Doppelpunkt oder ohne Text ist kein Befehl", () => {
    expect(befehlAus("Ändern wir das auf Freitag")).toBeNull();
    expect(befehlAus("ändern A7F2 Hallo")).toBeNull();
    expect(befehlAus("ändern A7F2:")).toBeNull();
  });
  it("normaler Text ist kein Befehl", () => {
    expect(befehlAus("ok, aber ruf ihn lieber an")).toBeNull();
    expect(befehlAus("Hallo Ceylan, alles gut?")).toBeNull();
    expect(befehlAus("")).toBeNull();
  });
});

describe("freigabeCode", () => {
  it("vier Zeichen aus der Entwurfs-ID, groß geschrieben", () => {
    expect(freigabeCode("a7f2a9c0-1111-2222-3333-444455556666")).toBe("A7F2");
  });
});

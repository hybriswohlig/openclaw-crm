import { describe, expect, it } from "vitest";
import { startStufeErgaenzen, waehleNeueAnfrage, waehleVorgeschlageneStufe } from "./stufen-wahl";

const s = (id: string, title: string, isActive = true, stageCategory: string | null = null) => ({
  id,
  title,
  isActive,
  stageCategory,
});

describe("waehleNeueAnfrage", () => {
  it("nimmt die aktive „Neue Anfrage“", () => {
    expect(waehleNeueAnfrage([s("a", "In Kontakt"), s("b", "Neue Anfrage")])?.id).toBe("b");
  });

  it("zieht „Neue Anfrage“ einer davor sortierten englischen Dublette vor", () => {
    expect(waehleNeueAnfrage([s("en", "Inquiry"), s("de", "Neue Anfrage")])?.id).toBe("de");
  });

  it("überspringt eine deaktivierte „Neue Anfrage“", () => {
    expect(waehleNeueAnfrage([s("alt", "Neue Anfrage", false), s("neu", "Anfrage", true, "open_new")])?.id).toBe("neu");
  });

  it("findet die Stufe über die Kategorie, wenn der Titel umbenannt wurde", () => {
    expect(waehleNeueAnfrage([s("x", "Geplant", true, "booked"), s("y", "Eingang", true, "open_new")])?.id).toBe("y");
  });

  it("nimmt „Inquiry“, wenn es keine deutsche Stufe gibt", () => {
    expect(waehleNeueAnfrage([s("a", "Contacted"), s("b", "Inquiry")])?.id).toBe("b");
  });

  it("fällt auf die erste aktive Stufe zurück", () => {
    expect(waehleNeueAnfrage([s("a", "Alt", false), s("b", "Sonstiges")])?.id).toBe("b");
  });

  it("nimmt notfalls die erste Stufe überhaupt", () => {
    expect(waehleNeueAnfrage([s("a", "Alt", false)])?.id).toBe("a");
  });

  it("liefert null ohne Stufen", () => {
    expect(waehleNeueAnfrage([])).toBeNull();
  });
});

describe("waehleVorgeschlageneStufe", () => {
  const produktion = [
    s("neu", "Neue Anfrage", true, "open_new"),
    s("kontakt", "In Kontakt", true, "open_engaged"),
    s("geplant", "Geplant", true, "booked"),
    s("planned", "Planned", false, "booked"),
    s("bezahlt", "Bezahlt (Abgeschlossen)", true, "paid"),
    s("paid", "Paid", false, "paid"),
  ];

  it("trifft den deutschen Titel", () => {
    expect(waehleVorgeschlageneStufe(produktion, "Geplant")?.id).toBe("geplant");
  });

  it("ignoriert Groß- und Kleinschreibung und den Klammerzusatz", () => {
    expect(waehleVorgeschlageneStufe(produktion, "bezahlt")?.id).toBe("bezahlt");
  });

  it("führt einen englischen Vorschlag auf die aktive deutsche Stufe", () => {
    expect(waehleVorgeschlageneStufe(produktion, "Planned")?.id).toBe("geplant");
    expect(waehleVorgeschlageneStufe(produktion, "Paid")?.id).toBe("bezahlt");
  });

  it("wählt nie eine ausgeblendete Stufe", () => {
    expect(waehleVorgeschlageneStufe([s("planned", "Planned", false, "booked")], "Planned")).toBeNull();
  });

  it("liefert null für Unbekanntes", () => {
    expect(waehleVorgeschlageneStufe(produktion, "Sonderfall")).toBeNull();
  });
});

describe("startStufeErgaenzen", () => {
  it("ergänzt die Stufe, wenn keine angegeben ist", () => {
    expect(startStufeErgaenzen({ name: "Müller" }, "neu")).toEqual({ name: "Müller", stage: "neu" });
    expect(startStufeErgaenzen({ name: "Müller", stage: "" }, "neu").stage).toBe("neu");
    expect(startStufeErgaenzen({ name: "Müller", stage: null }, "neu").stage).toBe("neu");
  });

  it("lässt eine angegebene Stufe stehen", () => {
    expect(startStufeErgaenzen({ stage: "geplant" }, "neu").stage).toBe("geplant");
  });

  it("ändert nichts ohne Startstufe", () => {
    expect(startStufeErgaenzen({ name: "Müller" }, null)).toEqual({ name: "Müller" });
  });
});

import { describe, expect, it, vi } from "vitest";
import { kiEingabe, kundeVorschlag, type KiFelder, type VorschlagQuellen } from "./kunde-vorschlag";

function quellen(over: Partial<VorschlagQuellen> = {}): VorschlagQuellen {
  return {
    eingang: vi.fn(async () => ({ texte: ["Hallo"], stand: "1:m1" })),
    gespeichert: vi.fn(async () => null),
    speichern: vi.fn(async () => {}),
    ki: vi.fn(async () => null),
    kiAnalyse: vi.fn(async () => null),
    ...over,
  };
}

describe("kundeVorschlag (Aus dem Chat übernehmen)", () => {
  it("Viktoria: die KI liest Name, E-Mail und Adressen mit Straße aus den eingehenden Nachrichten", async () => {
    const q = quellen({
      eingang: vi.fn(async () => ({ texte: ["Ich bin Viktoria Muster", "Hauptstraße 1, 72218 Wildberg"], stand: "2:m2" })),
      ki: vi.fn(async () => ({
        customer_name: "Viktoria Muster",
        customer_email: "V.Muster@beispiel.de",
        customer_phone: "0171 2345678",
        move_from_address: "Hauptstraße 1, 72218 Wildberg",
        move_to_address: "Bahnhofstr. 5, 71032 Böblingen",
      })),
    });
    expect(await kundeVorschlag("ws", "d1", q)).toEqual({
      quelle: "ki",
      name: "Viktoria Muster",
      email: "v.muster@beispiel.de",
      telefon: "0171 2345678",
      auszug: { strasse: "Hauptstraße 1", plz: "72218", ort: "Wildberg" },
      einzug: { strasse: "Bahnhofstr. 5", plz: "71032", ort: "Böblingen" },
      hinweis: null,
    });
    // Die KI bekommt nur die eingehenden Nachrichten; das Ergebnis wird mit dem Nachrichtenstand gespeichert.
    expect(q.ki).toHaveBeenCalledWith("ws", ["Ich bin Viktoria Muster", "Hauptstraße 1, 72218 Wildberg"]);
    expect(q.speichern).toHaveBeenCalledWith("ws", "d1", expect.objectContaining({ stand: "2:m2" }));
    expect(q.kiAnalyse).not.toHaveBeenCalled();
  });

  it("keine neue Nachricht seit der letzten Auswertung: gespeicherte nehmen, keine KI", async () => {
    const gespeichert: KiFelder = { customer_name: "Viktoria Muster", move_from_address: "Hauptstr. 1, 72218 Wildberg" };
    const q = quellen({ gespeichert: vi.fn(async () => ({ stand: "1:m1", ki: gespeichert })) });
    const v = await kundeVorschlag("ws", "d1", q);
    expect(v.name).toBe("Viktoria Muster");
    expect(q.ki).not.toHaveBeenCalled();
    // Neue Nachricht: frische Auswertung.
    const neu = quellen({ eingang: vi.fn(async () => ({ texte: ["Hallo", "neu"], stand: "2:m2" })), gespeichert: vi.fn(async () => ({ stand: "1:m1", ki: gespeichert })) });
    await kundeVorschlag("ws", "d1", neu);
    expect(neu.ki).toHaveBeenCalledTimes(1);
  });

  it("gleichzeitige Klicks: eine KI-Auswertung je Deal", async () => {
    let fertig: (k: KiFelder) => void = () => {};
    const ki = vi.fn(() => new Promise<KiFelder>((r) => (fertig = r)));
    const q = quellen({ ki });
    const a = kundeVorschlag("ws", "d1", q);
    const b = kundeVorschlag("ws", "d1", q);
    await vi.waitFor(() => expect(ki).toHaveBeenCalledTimes(1));
    fertig({ customer_name: "Viktoria Muster" });
    expect((await a).name).toBe("Viktoria Muster");
    expect((await b).name).toBe("Viktoria Muster");
    expect(ki).toHaveBeenCalledTimes(1);
  });

  it("Rückfall: Adresse der letzten KI-Analyse, dann Erkennung (nur PLZ und Ort)", async () => {
    const q = quellen({
      eingang: vi.fn(async () => ({ texte: ["Hallo, wir ziehen nach 71032 Böblingen.\nViele Grüße\nTel 0711 123456, 70999 Irgendwo"], stand: "1:x" })),
      kiAnalyse: vi.fn(async () => ({ von: "Königstr. 1, 70173 Stuttgart", nach: null })),
    });
    const v = await kundeVorschlag("ws", "d1", q);
    expect(v.auszug).toEqual({ strasse: "Königstr. 1", plz: "70173", ort: "Stuttgart" });
    expect(v.einzug).toEqual({ strasse: "", plz: "71032", ort: "Böblingen" });
    expect(v.quelle).toBe("ki_gespeichert");
    expect(v.name).toBeNull();
  });

  it("Telefonnummern und Kundennummern aus der KI landen nie als Adresse", async () => {
    const v = await kundeVorschlag(
      "ws",
      "d1",
      quellen({
        ki: vi.fn(async () => ({
          move_from_address: "Tel. 0711 123456, 70372 Stuttgart",
          move_to_address: "Kundennummer 12345",
          customer_email: "abc@mail.kleinanzeigen.de",
        })),
      })
    );
    expect(v.auszug).toEqual({ strasse: "", plz: "70372", ort: "Stuttgart" });
    expect(v.einzug).toBeNull();
    expect(v.email).toBeNull();
  });

  it("KI-Fehler: Erkennung trotzdem; ohne Kundennachricht ein Hinweis, keine KI", async () => {
    const kaputt = vi.fn(async () => {
      throw new Error("VPS weg");
    });
    const leer = await kundeVorschlag("ws", "d1", quellen({ ki: kaputt }));
    expect(leer.quelle).toBeNull();
    expect(leer.hinweis).toBe("Die KI-Auswertung hat nicht geklappt, und in den Nachrichten steht keine Adresse mit PLZ und Ort.");
    const erkannt = await kundeVorschlag(
      "ws",
      "d1",
      quellen({ ki: kaputt, eingang: vi.fn(async () => ({ texte: ["Wir ziehen von 70372 Stuttgart nach 71032 Böblingen"], stand: "1:y" })) })
    );
    expect(erkannt.quelle).toBe("erkennung");
    expect(erkannt.auszug).toEqual({ strasse: "", plz: "70372", ort: "Stuttgart" });
    const ohne = quellen({ eingang: vi.fn(async () => ({ texte: [], stand: "0:-" })) });
    expect((await kundeVorschlag("ws", "d1", ohne)).hinweis).toBe("In diesem Deal gibt es noch keine Nachricht vom Kunden.");
    expect(ohne.ki).not.toHaveBeenCalled();
  });

  it("KI-Eingabe: neueste Nachrichten, gekürzt und nummeriert", () => {
    const t = kiEingabe(["alt", "x".repeat(3000), "neu"]);
    expect(t.startsWith("[Nachricht 1]\nalt")).toBe(true);
    expect(t).toContain("[Nachricht 3]\nneu");
    expect(t.length).toBeLessThan(1700);
  });
});

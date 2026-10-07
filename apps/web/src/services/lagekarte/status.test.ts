import { describe, expect, it } from "vitest";
import { kartenStatus, stufenKategorie } from "./status";

const st = (titel: string, kategorie: string | null = null) => ({ titel, kategorie });

describe("stufenKategorie", () => {
  it("nimmt die gepflegte Kategorie", () => expect(stufenKategorie(st("Egal", "booked"))).toBe("booked"));
  it("mappt deutsche und englische Titel", () => {
    expect(stufenKategorie(st("Neue Anfrage"))).toBe("open_new");
    expect(stufenKategorie(st("Bezahlt (Abgeschlossen)"))).toBe("paid");
    expect(stufenKategorie(st("Information gathered (merged)"))).toBe("open_engaged");
    expect(stufenKategorie(st("Planned"))).toBe("booked");
  });
  it("liefert null für Unbekanntes", () => expect(stufenKategorie(st("Sonderfall"))).toBeNull());
  it("liefert null ohne Stufe", () => expect(stufenKategorie(null)).toBeNull());
  it("ignoriert eine ungültige Kategorie und fällt auf den Titel zurück", () => {
    expect(stufenKategorie(st("Verloren", "quatsch"))).toBe("lost");
  });
});

describe("kartenStatus", () => {
  it("Endstufe schlägt aktive Annahme (kein Turm für erledigte Jobs)", () => {
    expect(kartenStatus({ stufe: st("Durchgeführt", "done_unpaid"), kvaAktiv: true, angebotErstellt: true })).toEqual({ status: "erledigt", hinweis: null, zahlungOffen: true });
    expect(kartenStatus({ stufe: st("Bezahlt", "paid"), kvaAktiv: true, angebotErstellt: true }).status).toBe("erledigt");
    const v = kartenStatus({ stufe: st("Verloren", "lost"), kvaAktiv: true, angebotErstellt: true });
    expect(v.status).toBe("verloren");
    expect(v.hinweis).toContain("KV-Annahme aktiv");
  });
  it("bezahlt ist erledigt ohne offene Zahlung", () => {
    expect(kartenStatus({ stufe: st("Bezahlt", "paid"), kvaAktiv: false, angebotErstellt: false })).toEqual({ status: "erledigt", hinweis: null, zahlungOffen: false });
  });
  it("verloren ohne Annahme hat keinen Hinweis", () => {
    expect(kartenStatus({ stufe: st("Verloren", "lost"), kvaAktiv: false, angebotErstellt: false })).toEqual({ status: "verloren", hinweis: null, zahlungOffen: false });
  });
  it("Annahme bei offener Stufe ist Auftrag mit Hinweis", () => {
    const r = kartenStatus({ stufe: st("In Kontakt", "open_engaged"), kvaAktiv: true, angebotErstellt: true });
    expect(r.status).toBe("auftrag");
    expect(r.hinweis).toBe("KV angenommen, Stufe noch „In Kontakt“");
  });
  it("Geplant ist Auftrag", () => expect(kartenStatus({ stufe: st("Geplant", "booked"), kvaAktiv: false, angebotErstellt: false }).status).toBe("auftrag"));
  it("Geplant mit Annahme ist Auftrag ohne Hinweis", () => {
    expect(kartenStatus({ stufe: st("Geplant", "booked"), kvaAktiv: true, angebotErstellt: true })).toEqual({ status: "auftrag", hinweis: null, zahlungOffen: false });
  });
  it("Angebot erstellt macht aus Kontakt ein Angebot", () => expect(kartenStatus({ stufe: st("In Kontakt", "open_engaged"), kvaAktiv: false, angebotErstellt: true }).status).toBe("angebot"));
  it("Stufe Angebot ohne erstelltes Angebot ist Angebot", () => expect(kartenStatus({ stufe: st("Quoted", "quoted"), kvaAktiv: false, angebotErstellt: false }).status).toBe("angebot"));
  it("Kontakt und Neu", () => {
    expect(kartenStatus({ stufe: st("In Kontakt", "open_engaged"), kvaAktiv: false, angebotErstellt: false }).status).toBe("kontakt");
    expect(kartenStatus({ stufe: st("Neue Anfrage", "open_new"), kvaAktiv: false, angebotErstellt: false }).status).toBe("neu");
  });
  it("ohne Stufe ist Neu mit Hinweis", () => expect(kartenStatus({ stufe: null, kvaAktiv: false, angebotErstellt: false })).toEqual({ status: "neu", hinweis: "Import ohne Stufe", zahlungOffen: false }));
  it("ohne Stufe, aber mit Annahme ist Auftrag mit Hinweis", () => {
    expect(kartenStatus({ stufe: null, kvaAktiv: true, angebotErstellt: true })).toEqual({ status: "auftrag", hinweis: "KV angenommen, keine Stufe gesetzt", zahlungOffen: false });
  });
  it("unbekannte Stufe bleibt sichtbar", () => {
    const r = kartenStatus({ stufe: st("Sonderfall"), kvaAktiv: false, angebotErstellt: false });
    expect(r.status).toBe("unbekannt");
    expect(r.hinweis).toBe("Stufe „Sonderfall“ nicht zugeordnet");
  });
});

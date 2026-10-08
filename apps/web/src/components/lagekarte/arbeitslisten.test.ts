import { describe, expect, it } from "vitest";
import { beispielAntwort } from "@/lib/lagekarte/beispiel-daten";
import type { LeadPunkt, Mission, MissionArt } from "@/lib/lagekarte/typen";
import { berechneKennzahlen } from "@/services/lagekarte/kennzahlen";
import { arbeitslisten, gruppiereMissionen, heuteUndMorgen, MISSION_ART_LABEL, ohneOrtHinweis } from "./arbeitslisten";
import { filtereLeads, STANDARD_FILTER } from "./filter";

const JETZT = new Date("2026-10-08T07:30:00+02:00");
const basis = beispielAntwort(JETZT).leads[0];

function lead(teil: Partial<LeadPunkt> & { id: string }): LeadPunkt {
  return {
    ...basis,
    status: "kontakt",
    wartet: null,
    emailUngelesen: 0,
    umzugAm: null,
    alterChat: null,
    ...teil,
  };
}

function mission(art: MissionArt, leadId: string, dringlichkeit: Mission["dringlichkeit"], titel = art): Mission {
  return { id: `${art}:${leadId}`, art, titel, leadId, dringlichkeit };
}

describe("heuteUndMorgen (Ruling: Berliner Kalendertage)", () => {
  it("liefert den nächsten Berliner Kalendertag, auch am Abend vor der Zeitumstellung im Frühjahr", () => {
    // 28.03.2026, 23:30 MEZ: jetzt + 24 h wäre schon der 30.03. (MESZ).
    expect(heuteUndMorgen(new Date("2026-03-28T23:30:00+01:00"))).toEqual({ heute: "2026-03-28", morgen: "2026-03-29" });
  });

  it("rechnet über Monats- und Jahresgrenzen", () => {
    expect(heuteUndMorgen(new Date("2026-12-31T23:30:00+01:00"))).toEqual({ heute: "2026-12-31", morgen: "2027-01-01" });
    expect(heuteUndMorgen(new Date("2026-10-25T01:30:00+02:00"))).toEqual({ heute: "2026-10-25", morgen: "2026-10-26" });
  });
});

describe("arbeitslisten (Ruling 13: unabhängig vom Kartenfilter, ohne Verlorene)", () => {
  const wartetAlt = lead({ id: "w-alt", wartet: { art: "antwort", seit: "2026-10-01T10:00:00Z", chatId: "c1" } });
  const wartetNeu = lead({ id: "w-neu", wartet: { art: "neu_pruefen", seit: "2026-10-07T10:00:00Z", chatId: null }, status: "neu" });
  const verloren = lead({
    id: "v",
    status: "verloren",
    wartet: { art: "antwort", seit: "2026-10-02T10:00:00Z", chatId: "c2" },
    emailUngelesen: 3,
    umzugAm: "2026-10-08",
    ort: null,
  });
  const email = lead({ id: "e", emailUngelesen: 2 });
  const heute = lead({ id: "h", umzugAm: "2026-10-08", status: "auftrag" });
  const morgen = lead({ id: "m", umzugAm: "2026-10-09", status: "angebot" });
  const uebermorgen = lead({ id: "u", umzugAm: "2026-10-10", status: "auftrag" });
  const ohneOrt = lead({ id: "o", ort: null });
  if (!basis.ort) throw new Error("Beispiel-Lead ohne Ort");
  const nurZiel = lead({ id: "z", ort: { ...basis.ort, quelle: "zieladresse" }, angelegtAm: "2026-10-01T10:00:00Z" });
  const alle = [verloren, wartetNeu, wartetAlt, email, heute, morgen, uebermorgen, ohneOrt, nurZiel];

  it("Wartet: alle wartenden Leads, älteste zuerst, nie verlorene", () => {
    expect(arbeitslisten(alle, JETZT).wartend.map((l) => l.id)).toEqual(["w-alt", "w-neu"]);
  });

  it("E-Mails ungelesen ohne verlorene, meiste zuerst", () => {
    expect(arbeitslisten(alle, JETZT).emailUngelesen.map((l) => l.id)).toEqual(["e"]);
  });

  it("Heute: Umzüge heute und am nächsten Berliner Kalendertag, Aufträge zuerst, ohne verlorene", () => {
    expect(arbeitslisten(alle, JETZT).heute.map((l) => l.id)).toEqual(["h", "m"]);
  });

  it("Ohne Ort: ohne verlorene, auch Leads, die nur am Ziel stehen (M-2)", () => {
    expect(arbeitslisten(alle, JETZT).ohneOrt.map((l) => l.id)).toEqual(["o", "z"]);
  });

  it("Ohne-Ort-Hinweis: „nur Ziel bekannt“ oder „keine Adresse“", () => {
    expect(ohneOrtHinweis(nurZiel)).toBe(`nur Ziel bekannt: ${basis.ort?.ortsname}`);
    expect(ohneOrtHinweis(ohneOrt)).toBe("keine Adresse");
  });

  it("stimmt mit den HUD-Kennzahlen überein, auch wenn die Karte gefiltert ist", () => {
    const leads = beispielAntwort(JETZT).leads;
    const k = berechneKennzahlen(leads, JETZT);
    const listen = arbeitslisten(leads, JETZT);
    expect(listen.wartend.length).toBe(k.wartet.gesamt);
    expect(listen.emailUngelesen.length).toBe(k.emailUngelesen.leads);
    // „Ohne Ort“ = nicht verortet plus nur am Ziel verortet (stehen auf der Karte, Abholort fehlt).
    const nurZielAnzahl = leads.filter((l) => l.status !== "verloren" && l.ort?.quelle === "zieladresse").length;
    expect(listen.ohneOrt.length).toBe(k.verortet.gesamt - k.verortet.mitOrt + nurZielAnzahl);
    // Ein Kartenfilter, der fast alles ausblendet, ändert die Arbeitslisten nicht.
    const gefiltert = filtereLeads(leads, { ...STANDARD_FILTER, suche: "zzz-nichts" }, JETZT);
    expect(gefiltert).toHaveLength(0);
    expect(arbeitslisten(leads, JETZT).wartend.length).toBe(k.wartet.gesamt);
  });
});

describe("gruppiereMissionen (Ruling 14)", () => {
  const leadIds = new Set(["a", "b", "c", "d"]);
  const missionen: Mission[] = [
    mission("termin_ohne_auftrag", "a", 1),
    mission("zahlung_offen", "a", 2),
    mission("zahlung_offen", "b", 2),
    mission("wert_pruefen", "c", 2),
    mission("chat_aufraeumen", "c", 3),
    mission("chat_aufraeumen", "d", 3),
    mission("stufe_pflegen", "d", 3),
    mission("zahlung_offen", "geloescht", 2),
  ];

  it("bildet je Art eine Gruppe mit allen Fällen, nach Dringlichkeit sortiert", () => {
    const gruppen = gruppiereMissionen(missionen, leadIds);
    expect(gruppen.map((g) => [g.art, g.missionen.length])).toEqual([
      ["termin_ohne_auftrag", 1],
      ["zahlung_offen", 2],
      ["wert_pruefen", 1],
      ["stufe_pflegen", 1],
      ["chat_aufraeumen", 2],
    ]);
  });

  it("schneidet nichts ab: „Chat aufräumen“ bleibt sichtbar, auch hinter vielen dringenden Fällen", () => {
    const viele = Array.from({ length: 30 }, (_, i) => mission("zahlung_offen", `z${i}`, 2));
    const ids = new Set([...viele.map((m) => m.leadId), "c"]);
    const gruppen = gruppiereMissionen([...viele, mission("chat_aufraeumen", "c", 3)], ids);
    expect(gruppen.map((g) => g.art)).toEqual(["zahlung_offen", "chat_aufraeumen"]);
    expect(gruppen[0].missionen).toHaveLength(30);
  });

  it("behält die Reihenfolge des Servers innerhalb einer Art und lässt unbekannte Leads weg", () => {
    const gruppen = gruppiereMissionen(missionen, leadIds);
    expect(gruppen.find((g) => g.art === "zahlung_offen")?.missionen.map((m) => m.leadId)).toEqual(["a", "b"]);
  });

  it("sortiert nie nach Titel: der nächste Umzug bleibt vorn, wie vom Server geliefert (I-1)", () => {
    // Server-Reihenfolge: Dringlichkeit, dann Anlass (nächster Umzug zuerst). Alphabetisch stünde
    // „Umzug heute“ vor „Umzug in 10 Tagen“ vor „Umzug in 2 Tagen“ vor „Umzug morgen“.
    const server: Mission[] = [
      mission("termin_ohne_auftrag", "a", 1, "Umzug morgen, kein Auftrag"),
      mission("termin_ohne_auftrag", "b", 1, "Umzug in 2 Tagen, kein Auftrag"),
      mission("kv_nachfassen", "c", 2, "KV seit 10 Tagen ungesehen"),
      mission("kv_nachfassen", "d", 2, "KV seit 4 Tagen ungesehen"),
      mission("termin_ohne_auftrag", "c", 2, "Umzug in 10 Tagen, kein Auftrag"),
      mission("termin_ohne_auftrag", "d", 2, "Umzug heute, kein Auftrag"),
    ];
    const gruppen = gruppiereMissionen(server, leadIds);
    expect(gruppen.map((g) => [g.art, g.dringlichkeit])).toEqual([
      ["termin_ohne_auftrag", 1],
      ["kv_nachfassen", 2],
    ]);
    expect(gruppen[0].missionen.map((m) => m.titel)).toEqual([
      "Umzug morgen, kein Auftrag",
      "Umzug in 2 Tagen, kein Auftrag",
      "Umzug in 10 Tagen, kein Auftrag",
      "Umzug heute, kein Auftrag",
    ]);
    expect(gruppen[1].missionen.map((m) => m.leadId)).toEqual(["c", "d"]);
  });

  it("hält Arten gleicher Dringlichkeit in fester Reihenfolge, unabhängig von der Eingangsfolge", () => {
    const umgekehrt = gruppiereMissionen(
      [mission("stufe_pflegen", "a", 3), mission("chat_aufraeumen", "b", 3), mission("adresse_fehlt", "c", 3)],
      leadIds,
    );
    expect(umgekehrt.map((g) => g.art)).toEqual(["adresse_fehlt", "stufe_pflegen", "chat_aufraeumen"]);
  });

  it("hat für jede Art eine Beschriftung", () => {
    for (const label of Object.values(MISSION_ART_LABEL)) expect(label.length).toBeGreaterThan(0);
    expect(MISSION_ART_LABEL.chat_aufraeumen).toBe("Chat aufräumen");
    expect(MISSION_ART_LABEL.zahlung_offen).toBe("Zahlung offen");
  });
});

import { describe, expect, it } from "vitest";
import { beispielAntwort } from "@/lib/lagekarte/beispiel-daten";
import { WERT_PLAUSIBEL_MAX_CENT, type LeadPunkt } from "@/lib/lagekarte/typen";
import { erzeugeMissionen } from "./missionen";

const jetzt = new Date("2026-10-08T07:30:00+02:00");
const TAG = 24 * 60 * 60 * 1000;
const vor = (tage: number) => new Date(jetzt.getTime() - tage * TAG).toISOString();
const basis = beispielAntwort(jetzt).leads[0];
let zaehler = 0;
const lead = (p: Partial<LeadPunkt>): LeadPunkt => ({
  ...basis,
  id: `lead-${zaehler++}`,
  status: "kontakt",
  umzugAm: null,
  wert: null,
  bezahltCent: 0,
  angelegtAm: vor(1),
  wartet: null,
  statusHinweis: null,
  zahlungOffen: false,
  veraltet: false,
  emailUngelesen: 0,
  alterChat: null,
  ...p,
  kv: { ...basis.kv, ...(p.kv ?? {}) },
});
const kvLink = (kv: Partial<LeadPunkt["kv"]>): LeadPunkt["kv"] => ({
  ...basis.kv,
  linkAktiv: true,
  linkErstelltAm: vor(1),
  linkAngesehenAnzahl: 0,
  linkZuletztAngesehen: null,
  angenommenAm: null,
  ...kv,
});

describe("erzeugeMissionen", () => {
  it("Annahme ohne passende Stufe ist dringend", () => {
    const m = erzeugeMissionen([lead({ status: "auftrag", statusHinweis: "KV angenommen, Stufe noch „In Kontakt“" })], jetzt);
    expect(m[0]).toMatchObject({ art: "auftrag_stufe", dringlichkeit: 1, titel: "KV angenommen, Stufe auf „Geplant“ setzen" });
  });

  it("andere Statushinweise erzeugen keine Stufen-Mission", () => {
    const m = erzeugeMissionen([lead({ status: "erledigt", statusHinweis: "Bezahlt, aber Stufe offen" })], jetzt);
    expect(m.find((x) => x.art === "auftrag_stufe")).toBeUndefined();
  });

  it("vergibt stabile IDs aus Art und Lead", () => {
    const l = lead({ status: "auftrag", statusHinweis: "KV angenommen, Stufe noch „In Kontakt“" });
    expect(erzeugeMissionen([l], jetzt)[0]).toMatchObject({ id: `auftrag_stufe:${l.id}`, leadId: l.id });
  });

  describe("termin_ohne_auftrag", () => {
    const titel = (umzugAm: string, status: LeadPunkt["status"] = "angebot") =>
      erzeugeMissionen([lead({ status, umzugAm })], jetzt).find((x) => x.art === "termin_ohne_auftrag");

    it("Termin morgen ohne Auftrag", () => {
      expect(titel("2026-10-09")?.titel).toBe("Umzug morgen, noch kein Auftrag");
    });
    it("Termin heute", () => {
      expect(titel("2026-10-08")).toMatchObject({ titel: "Umzug heute, noch kein Auftrag", dringlichkeit: 1 });
    });
    it("Termin in mehreren Tagen, letzter Tag des Fensters ist 14", () => {
      expect(titel("2026-10-12")?.titel).toBe("Umzug in 4 Tagen, noch kein Auftrag");
      expect(titel("2026-10-22")?.titel).toBe("Umzug in 14 Tagen, noch kein Auftrag");
      expect(titel("2026-10-23")).toBeUndefined();
    });
    it("Termin in der Vergangenheit erzeugt nichts", () => {
      expect(titel("2026-10-07")).toBeUndefined();
    });
    it("gilt für neu, kontakt und angebot, nicht für auftrag und erledigt", () => {
      expect(titel("2026-10-09", "neu")).toBeDefined();
      expect(titel("2026-10-09", "kontakt")).toBeDefined();
      expect(titel("2026-10-09", "auftrag")).toBeUndefined();
      expect(titel("2026-10-09", "erledigt")).toBeUndefined();
    });
    it("rechnet über den Monatswechsel", () => {
      const ende = new Date("2026-10-30T10:00:00+01:00");
      const m = erzeugeMissionen([lead({ status: "angebot", umzugAm: "2026-11-02" })], ende);
      expect(m.find((x) => x.art === "termin_ohne_auftrag")?.titel).toBe("Umzug in 3 Tagen, noch kein Auftrag");
    });
  });

  describe("kv_nachfassen", () => {
    const nachfassen = (l: Partial<LeadPunkt>) =>
      erzeugeMissionen([lead({ status: "angebot", ...l })], jetzt).find((x) => x.art === "kv_nachfassen");

    it("ungesehener KV nach mehr als 3 Tagen", () => {
      expect(nachfassen({ kv: kvLink({ linkErstelltAm: vor(4.2) }) })).toMatchObject({
        titel: "KV seit 4 Tagen ungesehen: nachfassen",
        dringlichkeit: 2,
      });
    });
    it("ungesehener KV nach höchstens 3 Tagen noch nicht", () => {
      expect(nachfassen({ kv: kvLink({ linkErstelltAm: vor(3) }) })).toBeUndefined();
      expect(nachfassen({ kv: kvLink({ linkErstelltAm: vor(1) }) })).toBeUndefined();
    });
    it("ohne aktiven Link oder Erstelldatum keine Mission", () => {
      expect(nachfassen({ kv: kvLink({ linkAktiv: false, linkErstelltAm: vor(9) }) })).toBeUndefined();
      expect(nachfassen({ kv: kvLink({ linkErstelltAm: null }) })).toBeUndefined();
    });
    it("angesehen, aber seit mehr als 5 Tagen keine Annahme", () => {
      expect(nachfassen({ kv: kvLink({ linkAngesehenAnzahl: 2, linkZuletztAngesehen: vor(6.5) }) })).toMatchObject({
        titel: "KV angesehen, seit 6 Tagen keine Annahme",
        dringlichkeit: 2,
      });
    });
    it("angesehen vor höchstens 5 Tagen noch nicht", () => {
      expect(nachfassen({ kv: kvLink({ linkAngesehenAnzahl: 2, linkZuletztAngesehen: vor(5) }) })).toBeUndefined();
    });
    it("angesehen, aber ohne Zeitpunkt keine Mission", () => {
      expect(nachfassen({ kv: kvLink({ linkAngesehenAnzahl: 1, linkZuletztAngesehen: null }) })).toBeUndefined();
    });
    it("nur im Status angebot", () => {
      expect(nachfassen({ status: "kontakt", kv: kvLink({ linkErstelltAm: vor(9) }) })).toBeUndefined();
      expect(nachfassen({ status: "auftrag", kv: kvLink({ linkErstelltAm: vor(9) }) })).toBeUndefined();
    });
    it("erzeugt je Lead höchstens eine Nachfass-Mission", () => {
      const m = erzeugeMissionen([lead({ status: "angebot", kv: kvLink({ linkAngesehenAnzahl: 2, linkZuletztAngesehen: vor(8), linkErstelltAm: vor(20) }) })], jetzt);
      expect(m.filter((x) => x.art === "kv_nachfassen")).toHaveLength(1);
    });
  });

  describe("zahlung_offen", () => {
    const zahlung = (p: Partial<LeadPunkt>) =>
      erzeugeMissionen([lead({ status: "erledigt", zahlungOffen: true, ...p })], jetzt).find((x) => x.art === "zahlung_offen");

    it("mit bekanntem Wert wird der offene Rest genannt", () => {
      expect(zahlung({ wert: { cent: 120000, art: "bestaetigt" }, bezahltCent: 20000 })).toMatchObject({
        titel: "Durchgeführt, Zahlung offen · 1.000\u00a0€ offen",
        dringlichkeit: 2,
      });
    });
    it("ohne Wert nur der Grundtext", () => {
      expect(zahlung({ wert: null })?.titel).toBe("Durchgeführt, Zahlung offen");
    });
    it("ist der Wert schon gedeckt, nur der Grundtext", () => {
      expect(zahlung({ wert: { cent: 50000, art: "bestaetigt" }, bezahltCent: 50000 })?.titel).toBe("Durchgeführt, Zahlung offen");
    });
    it("ohne Flag keine Mission", () => {
      expect(zahlung({ zahlungOffen: false })).toBeUndefined();
    });
  });

  describe("wert_pruefen (Ruling 7)", () => {
    const pruefen = (p: Partial<LeadPunkt>) =>
      erzeugeMissionen([lead(p)], jetzt).find((x) => x.art === "wert_pruefen");

    it("Wert über 50.000 € erzeugt „Wert prüfen“ mit Dringlichkeit 2", () => {
      const l = lead({ status: "auftrag", wert: { cent: 1_000_000_000, art: "bestaetigt" } });
      expect(erzeugeMissionen([l], jetzt).find((x) => x.art === "wert_pruefen")).toEqual({
        id: `wert_pruefen:${l.id}`,
        art: "wert_pruefen",
        titel: "Wert prüfen: 10.000.000\u00a0€",
        leadId: l.id,
        dringlichkeit: 2,
      });
    });
    it("gilt auch für Schätzungen", () => {
      expect(pruefen({ status: "kontakt", wert: { cent: 6_000_000, art: "schaetzung" } })?.titel).toBe("Wert prüfen: 60.000\u00a0€");
    });
    it("genau 50.000 € und unbekannte Werte erzeugen nichts", () => {
      expect(pruefen({ wert: { cent: WERT_PLAUSIBEL_MAX_CENT, art: "angebot" } })).toBeUndefined();
      expect(pruefen({ wert: null })).toBeUndefined();
    });
    it("verlorene Leads erzeugen keine Wert-Mission", () => {
      expect(pruefen({ status: "verloren", wert: { cent: 1_000_000_000, art: "bestaetigt" } })).toBeUndefined();
    });
    it("offene Zahlung mit unplausiblem Wert nennt keinen Restbetrag", () => {
      const m = erzeugeMissionen(
        [lead({ status: "erledigt", zahlungOffen: true, wert: { cent: 1_000_000_000, art: "bestaetigt" }, bezahltCent: 0 })],
        jetzt,
      );
      expect(m.find((x) => x.art === "zahlung_offen")?.titel).toBe("Durchgeführt, Zahlung offen");
    });
  });

  describe("adresse_fehlt", () => {
    const adresse = (p: Partial<LeadPunkt>) =>
      erzeugeMissionen([lead({ ort: null, ...p })], jetzt).find((x) => x.art === "adresse_fehlt");

    it("neuer Lead ohne Ort", () => {
      expect(adresse({ status: "neu", angelegtAm: vor(3) })).toMatchObject({
        titel: "Abholadresse fehlt für den KV",
        dringlichkeit: 3,
      });
    });
    it("Kontakt ohne Ort, 30 Tage alt ist noch drin, 31 nicht", () => {
      expect(adresse({ status: "kontakt", angelegtAm: vor(30) })).toBeDefined();
      expect(adresse({ status: "kontakt", angelegtAm: vor(31) })).toBeUndefined();
    });
    it("nicht bei anderen Status", () => {
      expect(adresse({ status: "angebot" })).toBeUndefined();
      expect(adresse({ status: "auftrag" })).toBeUndefined();
    });
    it("nicht, wenn ein Ort bekannt ist", () => {
      expect(adresse({ status: "neu", ort: basis.ort })).toBeUndefined();
    });
  });

  describe("stufe_pflegen", () => {
    it("veralteter Lead nennt das Alter in Tagen", () => {
      const m = erzeugeMissionen([lead({ status: "neu", veraltet: true, angelegtAm: vor(12.4) })], jetzt);
      expect(m.find((x) => x.art === "stufe_pflegen")).toMatchObject({
        titel: "Seit 12 Tagen „Neue Anfrage“: Stufe pflegen",
        dringlichkeit: 3,
      });
    });
    it("ohne veraltet keine Mission", () => {
      expect(erzeugeMissionen([lead({ status: "neu", veraltet: false, angelegtAm: vor(12) })], jetzt).find((x) => x.art === "stufe_pflegen")).toBeUndefined();
    });
  });

  it("ein Lead kann mehrere Missionen bekommen", () => {
    const m = erzeugeMissionen(
      [lead({ status: "neu", ort: null, veraltet: true, angelegtAm: vor(10), umzugAm: "2026-10-10" })],
      jetzt,
    );
    expect(m.map((x) => x.art).sort()).toEqual(["adresse_fehlt", "stufe_pflegen", "termin_ohne_auftrag"]);
  });

  it("verlorene Leads ohne offenen WhatsApp-Chat erzeugen keine Missionen", () => {
    expect(
      erzeugeMissionen(
        [
          lead({
            status: "verloren",
            zahlungOffen: true,
            veraltet: true,
            ort: null,
            umzugAm: "2026-10-09",
            statusHinweis: "KV angenommen, Stufe noch „In Kontakt“",
          }),
        ],
        jetzt,
      ),
    ).toEqual([]);
  });

  describe("Sortierung und Vollständigkeit", () => {
    it("sortiert nach Dringlichkeit, dann ältester Anlass zuerst", () => {
      const spaet = lead({ status: "neu", veraltet: true, angelegtAm: vor(9), ort: basis.ort });
      const frueh = lead({ status: "neu", veraltet: true, angelegtAm: vor(20), ort: basis.ort });
      const zahlung = lead({ status: "erledigt", zahlungOffen: true });
      const dringend = lead({ status: "auftrag", statusHinweis: "KV angenommen, Stufe noch „In Kontakt“" });
      const m = erzeugeMissionen([spaet, frueh, zahlung, dringend], jetzt);
      expect(m.map((x) => x.leadId)).toEqual([dringend.id, zahlung.id, frueh.id, spaet.id]);
    });

    it("bei gleicher Dringlichkeit kommt der früher angenommene KV zuerst", () => {
      const a = lead({ status: "auftrag", statusHinweis: "KV angenommen, Stufe x", kv: { ...basis.kv, angenommenAm: vor(1) } });
      const b = lead({ status: "auftrag", statusHinweis: "KV angenommen, Stufe x", kv: { ...basis.kv, angenommenAm: vor(5) } });
      expect(erzeugeMissionen([a, b], jetzt).map((x) => x.leadId)).toEqual([b.id, a.id]);
    });

    it("bei gleicher Dringlichkeit kommt der nähere Umzugstermin zuerst", () => {
      const spaet = lead({ status: "kontakt", umzugAm: "2026-10-15" });
      const frueh = lead({ status: "kontakt", umzugAm: "2026-10-09" });
      expect(erzeugeMissionen([spaet, frueh], jetzt).map((x) => x.leadId)).toEqual([frueh.id, spaet.id]);
    });

    it("liefert alle Missionen ohne Obergrenze (Ruling 14), dringlichste zuerst", () => {
      const leichte = Array.from({ length: 15 }, (_, i) => lead({ status: "neu", veraltet: true, angelegtAm: vor(10 + i), ort: basis.ort }));
      const alteChats = Array.from({ length: 5 }, (_, i) => lead({ status: "kontakt", alterChat: { chatId: `c${i}`, seit: vor(20 + i) } }));
      const dringend = lead({ status: "auftrag", statusHinweis: "KV angenommen, Stufe x" });
      const m = erzeugeMissionen([...leichte, ...alteChats, dringend], jetzt);
      expect(m).toHaveLength(21);
      expect(m[0].leadId).toBe(dringend.id);
      expect(m.filter((x) => x.art === "chat_aufraeumen")).toHaveLength(5);
    });

    it("ist unabhängig von der Eingabereihenfolge", () => {
      const a = lead({ status: "neu", veraltet: true, angelegtAm: vor(10), ort: basis.ort });
      const b = lead({ status: "neu", veraltet: true, angelegtAm: vor(10), ort: basis.ort });
      expect(erzeugeMissionen([a, b], jetzt)).toEqual(erzeugeMissionen([b, a], jetzt));
    });
  });

  describe("chat_aufraeumen (Ruling 9)", () => {
    it("alter offener WhatsApp-Chat: antworten oder schließen, Dringlichkeit 3", () => {
      const l = lead({ status: "kontakt", alterChat: { chatId: "c1", seit: vor(20) } });
      const m = erzeugeMissionen([l], jetzt).find((x) => x.art === "chat_aufraeumen");
      expect(m).toEqual({
        id: `chat_aufraeumen:${l.id}`,
        art: "chat_aufraeumen",
        titel: "WhatsApp seit 20 Tagen offen: antworten oder Chat schließen",
        leadId: l.id,
        dringlichkeit: 3,
      });
    });

    it("Tage zählen ab der ersten offenen Kundennachricht, angefangene Tage nicht", () => {
      const l = lead({ status: "angebot", alterChat: { chatId: "c1", seit: new Date(jetzt.getTime() - 15.5 * TAG).toISOString() } });
      expect(erzeugeMissionen([l], jetzt).find((x) => x.art === "chat_aufraeumen")?.titel).toBe(
        "WhatsApp seit 15 Tagen offen: antworten oder Chat schließen",
      );
    });

    it("ohne alten Chat keine Mission", () => {
      expect(erzeugeMissionen([lead({ status: "kontakt" })], jetzt).find((x) => x.art === "chat_aufraeumen")).toBeUndefined();
    });

    it("steht hinter dringlicheren Missionen, ältester alter Chat zuerst", () => {
      const jung = lead({ status: "kontakt", alterChat: { chatId: "a", seit: vor(16) } });
      const alt = lead({ status: "kontakt", alterChat: { chatId: "b", seit: vor(40) } });
      const zahlung = lead({ status: "erledigt", zahlungOffen: true });
      expect(erzeugeMissionen([jung, alt, zahlung], jetzt).map((x) => x.leadId)).toEqual([zahlung.id, alt.id, jung.id]);
    });
  });

  describe("chat_aufraeumen nach Verloren (Grok 4)", () => {
    // jetzt = 2026-10-08 07:30 Berlin; Kalendertage in Europe/Berlin.
    const verloren = (seit: string, p: Partial<LeadPunkt> = {}) =>
      lead({ status: "verloren", alterChat: { chatId: "c-v", seit }, ...p });

    it("verlorener Lead mit offenem WhatsApp-Chat bekommt genau die Mission „Chat aufräumen“", () => {
      const l = verloren("2026-10-03T18:00:00+02:00");
      expect(erzeugeMissionen([l], jetzt)).toEqual([
        {
          id: `chat_aufraeumen:${l.id}`,
          art: "chat_aufraeumen",
          titel: "WhatsApp nach Verloren: Kunde schrieb vor 5 Tagen",
          leadId: l.id,
          dringlichkeit: 3,
        },
      ]);
    });

    it("heute und gestern statt „vor 0/1 Tagen“ (Berliner Kalendertage)", () => {
      const titel = (seit: string) => erzeugeMissionen([verloren(seit)], jetzt)[0]?.titel;
      expect(titel("2026-10-08T06:00:00+02:00")).toBe("WhatsApp nach Verloren: Kunde schrieb heute");
      expect(titel("2026-10-08T00:10:00+02:00")).toBe("WhatsApp nach Verloren: Kunde schrieb heute");
      expect(titel("2026-10-07T23:50:00+02:00")).toBe("WhatsApp nach Verloren: Kunde schrieb gestern");
      expect(titel("2026-10-06T08:00:00+02:00")).toBe("WhatsApp nach Verloren: Kunde schrieb vor 2 Tagen");
    });

    it("andere Signale eines verlorenen Leads bleiben ohne Mission", () => {
      const l = verloren(vor(3), {
        zahlungOffen: true,
        veraltet: true,
        ort: null,
        umzugAm: "2026-10-09",
        statusHinweis: "KV angenommen, Stufe noch „In Kontakt“",
        wert: { cent: 1_000_000_000, art: "bestaetigt" },
      });
      expect(erzeugeMissionen([l], jetzt).map((x) => x.art)).toEqual(["chat_aufraeumen"]);
    });

    it("steht nach Anlass sortiert zwischen den anderen alten Chats", () => {
      const aktiv = lead({ status: "kontakt", alterChat: { chatId: "a", seit: vor(20) } });
      const weg = verloren(vor(3));
      expect(erzeugeMissionen([weg, aktiv], jetzt).map((x) => x.leadId)).toEqual([aktiv.id, weg.id]);
    });
  });
});

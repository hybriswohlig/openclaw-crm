import { describe, expect, it, vi } from "vitest";
import { PLAN5_FEHLER_TEXT } from "@/lib/angebot-wahl";
import { PAKETE_5B, STUNDEN_5B, weberAnsicht5b } from "@/lib/kalkulations-ansicht-5b.fixture";
import type { AnpassungAnsicht } from "@/lib/kalkulations-ansicht";
import { istPreisStart, startFuer } from "./anpassung-start";
import { bestehendeAnpassung, preisSchluessel } from "./preis-dialog";
import {
  hebelText,
  kernHinweis,
  paketpreisPruefen,
  sperrAusgang,
  sperrKoerper,
  stundenKundentext,
  stundenZeilen,
  tagespreiseKnopf,
  TERMIN_DIALOG_EVENT,
  terminDialogOeffnen,
  zahlAus,
} from "./preis-logik";

const komfort = PAKETE_5B.find((p) => p.slug === "komfort")!;
const einzel = PAKETE_5B.find((p) => p.slug === "einzeltransport")!;

describe("zahlAus", () => {
  it("liest deutsche Beträge mit Komma und Tausenderpunkt", () => {
    expect(zahlAus("2.390")).toBe(2390);
    expect(zahlAus("2.390,50")).toBe(2390.5);
    expect(zahlAus("2390,5")).toBe(2390.5);
    expect(zahlAus("2390.5")).toBe(2390.5);
    expect(zahlAus(" 2390 € ")).toBe(2390);
    expect(zahlAus("")).toBeNull();
    expect(zahlAus("abc")).toBeNull();
  });
});

describe("paketpreisPruefen (Untergrenze 30 % Marge, vorab im Dialog)", () => {
  it("über der Untergrenze: Wert in Euro wie im Vertrag `{ betrag }`", () => {
    expect(paketpreisPruefen("2.390", komfort)).toEqual({ ok: true, wert: { betrag: 2390 } });
    expect(paketpreisPruefen("2190", komfort)).toEqual({ ok: true, wert: { betrag: 2190 } });
  });

  it("unter der Untergrenze: Meldung mit dem Mindestpreis, nichts gesendet", () => {
    const r = paketpreisPruefen("2.189,99", komfort);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.meldung).toBe("Mindestens 2.190 €: darunter läge die Marge unter 30 %.");
  });

  it("leer, null, negativ oder mehr als zwei Nachkommastellen lehnt ab", () => {
    expect(paketpreisPruefen("", komfort).ok).toBe(false);
    expect(paketpreisPruefen("0", komfort).ok).toBe(false);
    expect(paketpreisPruefen("-5", komfort).ok).toBe(false);
    expect(paketpreisPruefen("2400,005", komfort).ok).toBe(false);
    expect(paketpreisPruefen("2400", null)).toEqual({ ok: false, meldung: "Bitte ein Paket wählen." });
  });

  it("Paket ohne Rechnerpreis (Einzeltransport, F7): ohne Untergrenze, der Server prüft", () => {
    expect(paketpreisPruefen("450", einzel)).toEqual({ ok: true, wert: { betrag: 450 } });
  });
});

describe("Schlüssel und bestehende Anpassung", () => {
  const anp = (art: string, key: string): AnpassungAnsicht =>
    ({ id: `a_${key}`, art, key, text: "x", wert: null, von: "Dario", am: "Fr 06.11.", grund: "g" }) as unknown as AnpassungAnsicht;

  it("paketpreis: Slug, preismodus: „modus“, kv_darstellung: „kv“", () => {
    expect(preisSchluessel("paketpreis", "komfort")).toBe("komfort");
    expect(preisSchluessel("preismodus", "komfort")).toBe("modus");
    expect(preisSchluessel("kv_darstellung", "komfort")).toBe("kv");
  });

  it("findet nur dieselbe Art mit demselben Schlüssel", () => {
    const liste = [anp("paketpreis", "komfort"), anp("marge", "marge")];
    expect(bestehendeAnpassung(liste, "paketpreis", "komfort")?.id).toBe("a_komfort");
    expect(bestehendeAnpassung(liste, "paketpreis", "premium")).toBeNull();
    expect(bestehendeAnpassung(liste, "preismodus", "modus")).toBeNull();
  });

  it("Klick auf eine 5b-Anpassung öffnet den Preis-Dialog vorbelegt, Tagespreis den Termin-Dialog", () => {
    const paket = { ...anp("paketpreis", "komfort"), wert: { betrag: 2390 } } as unknown as AnpassungAnsicht;
    const s = startFuer(paket);
    expect(s).toEqual({ art: "paketpreis", slug: "komfort", betrag: 2390 });
    expect(istPreisStart(s)).toBe(true);
    expect(startFuer({ ...anp("preismodus", "modus"), wert: "stunden" })).toEqual({ art: "preismodus", modus: "stunden" });
    expect(startFuer({ ...anp("kv_darstellung", "kv"), wert: "ein_posten" })).toEqual({ art: "kv_darstellung", wert: "ein_posten" });
    expect(startFuer(anp("tagespreis", "2026-11-21"))).toEqual({ art: "termin" });
    expect(istPreisStart(startFuer({ ...anp("marge", "marge"), wert: 38 }))).toBe(false);
  });
});

describe("kernHinweis (F13: nie automatisch zusammenklappen)", () => {
  it("klein: gold mit Anteil und „Als ein Posten zeigen“", () => {
    const h = kernHinweis({ art: "klein", anteil: 0.384 }, "posten");
    expect(h).toMatchObject({ ton: "gold", aktion: "ein_posten", knopf: "Als ein Posten zeigen" });
    expect(h?.text).toContain("nur 38 % des Preises");
  });

  it("negativ: Text des Vertrags, kein Knopf", () => {
    expect(kernHinweis({ art: "negativ" }, "posten")).toEqual({
      ton: "rose",
      text: PLAN5_FEHLER_TEXT.KERN_NEGATIV,
      aktion: null,
      knopf: null,
    });
  });

  it("schon als ein Posten: „Wieder einzeln zeigen“, auch ohne Befund", () => {
    expect(kernHinweis(null, "ein_posten")).toMatchObject({ ton: "blau", aktion: "posten", knopf: "Wieder einzeln zeigen" });
  });

  it("ok, ein Posten oder kein Befund: nichts", () => {
    expect(kernHinweis({ art: "ok" }, "posten")).toBeNull();
    expect(kernHinweis({ art: "ein_posten" }, "posten")).toBeNull();
    expect(kernHinweis(null, "posten")).toBeNull();
  });

  it("keine Gedankenstriche in den Texten", () => {
    for (const k of [{ art: "klein", anteil: 0.3 } as const, { art: "negativ" } as const]) {
      expect(kernHinweis(k, "posten")?.text).not.toMatch(/[–—]/);
    }
  });
});

describe("Stunden-Ansicht", () => {
  it("Helfer, Transporter, Stunden, Mindeststunden mit Sätzen", () => {
    expect(stundenZeilen(STUNDEN_5B).map((z) => [z.label, z.wert])).toEqual([
      ["3 Helfer", "35 €/h"],
      ["1 Transporter", "25 €/h"],
      ["Stunden geschätzt", "7,5 h"],
      ["Mindeststunden", "3 h"],
    ]);
  });

  it("feste Zusatzposten als eigene Zeilen", () => {
    const z = stundenZeilen({ ...STUNDEN_5B, zusatzposten: [{ bezeichnung: "Halteverbot", betragCent: 12000 }] });
    expect(z.at(-1)).toEqual({ label: "Halteverbot", wert: "120 €", formel: "fester Zusatzposten" });
  });

  it("Kundentext nach Entscheidung 9", () => {
    expect(stundenKundentext(STUNDEN_5B)).toBe("voraussichtlich 985 €, abgerechnet nach Aufwand, mindestens 3 Stunden (390 €)");
    expect(stundenKundentext({ ...STUNDEN_5B, mindestStunden: 1 })).toContain("mindestens 1 Stunde (");
  });
});

describe("hebelText", () => {
  it("Basis „nur Kern“, sonst Kern plus Leistungen", () => {
    expect(hebelText([])).toBe("nur Kern");
    expect(hebelText(["halteverbot", "montage"])).toBe("Kern + Halteverbot, Montage");
    expect(hebelText(undefined)).toBeNull();
  });
});

describe("Sperren mit Preis-Hash und Moduswechsel", () => {
  it("mit Hash: nur erwartetPreisHash, kein Einzelpreis", () => {
    const a = weberAnsicht5b("pakete");
    expect(sperrKoerper(a)).toEqual({ bestaetigtSpanne: false, erwartetPreisHash: a.preisHash });
  });

  it("ohne Hash (Schalter aus, alter Server): wie vor 5b mit erwartetPreisCent", () => {
    const a = weberAnsicht5b("aus");
    expect(a.preisHash).toBeNull();
    expect(sperrKoerper(a)).toEqual({ bestaetigtSpanne: false, erwartetPreisCent: a.kv?.summeCent ?? a.preis.gerundetCent });
  });

  it("nach der Rückfrage: modusWechselBestaetigt true, sonst nie gesetzt", () => {
    const a = weberAnsicht5b("pakete");
    expect(sperrKoerper(a, { modusWechselBestaetigt: true }).modusWechselBestaetigt).toBe(true);
    expect("modusWechselBestaetigt" in sperrKoerper(a, { modusWechselBestaetigt: false })).toBe(false);
  });

  it("Spanne bestätigt die Obergrenze wie vorher", () => {
    const a = weberAnsicht5b("pakete");
    const mitSpanne = { ...a, kv: a.kv ? { ...a.kv, obergrenze: true } : null };
    expect(sperrKoerper(mitSpanne).bestaetigtSpanne).toBe(a.kv !== null);
  });

  it("ordnet die Antworten des Dienstes ein, Texte unverändert", () => {
    expect(sperrAusgang({ ok: true, data: {} })).toEqual({ art: "ok" });
    expect(sperrAusgang({ ok: false, status: 409, code: "PREIS_GEAENDERT", message: "Preis anders." })).toEqual({
      art: "preis_geaendert",
      meldung: "Preis anders.",
    });
    expect(sperrAusgang({ ok: false, status: 409, code: "MODUSWECHSEL", message: PLAN5_FEHLER_TEXT.MODUSWECHSEL })).toEqual({
      art: "moduswechsel",
      meldung: PLAN5_FEHLER_TEXT.MODUSWECHSEL,
    });
    expect(sperrAusgang({ ok: false, status: 409, code: "PAKET_OHNE_HEBEL", message: PLAN5_FEHLER_TEXT.PAKET_OHNE_HEBEL })).toEqual({
      art: "fehler",
      meldung: PLAN5_FEHLER_TEXT.PAKET_OHNE_HEBEL,
    });
  });
});

describe("Tagespreise im Termin-Dialog", () => {
  it("aktiv nur mit Schalter und nicht beim Stunden-KV", () => {
    expect(tagespreiseKnopf({ angebotAusKalkulation: true, tagespreise: true }, { preisModus: "fest" })).toEqual({ aktiv: true, hinweis: null });
    expect(tagespreiseKnopf({ angebotAusKalkulation: true, tagespreise: false }, { preisModus: "fest" }).aktiv).toBe(false);
    expect(tagespreiseKnopf({ angebotAusKalkulation: true, tagespreise: true }, { preisModus: "stunden" }).aktiv).toBe(false);
  });

  it("löst `neu:termin-dialog-oeffnen` mit Deal und Version aus", () => {
    const ziel = new EventTarget();
    const fang = vi.fn();
    ziel.addEventListener(TERMIN_DIALOG_EVENT, (e) => fang((e as CustomEvent).detail));
    terminDialogOeffnen({ dealId: "deal_weber", version: 2 }, ziel);
    expect(TERMIN_DIALOG_EVENT).toBe("neu:termin-dialog-oeffnen");
    expect(fang).toHaveBeenCalledWith({ dealId: "deal_weber", version: 2 });
  });
});

import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { KvErzeugung } from "@/lib/angebot-wahl";
import type { KalkulationsAnsicht } from "@/lib/kalkulations-ansicht";
import { eventBetrifftDeal, kvKnopf, kvLaeuftLange, kvMarke, kvStatus, KV_LANGE_MS } from "./kv-erzeugung";
import { KvVorschau } from "./kv-vorschau";
import { SperrenBereich } from "./sperren-bereich";

// Vitest übersetzt JSX klassisch (React.createElement): React global bereitstellen.
(globalThis as { React?: typeof React }).React = React;

const JETZT = new Date("2026-11-07T10:00:00.000Z");
const DOK = { id: "doc_1", fileName: "KV-Weber.pdf" };

function version(kvErzeugung: KvErzeugung, extra: Partial<KalkulationsAnsicht["version"]> = {}): KalkulationsAnsicht["version"] {
  return {
    nummer: 1,
    status: "gesperrt",
    bearbeitbar: false,
    gesperrtText: "v1 gesperrt · noch nicht gesendet",
    veraltet: false,
    veraltetGrund: null,
    fehler: null,
    tarif: null,
    kvDokument: null,
    kvErstellbar: true,
    kvErzeugung,
    sperrbar: false,
    sperrGrund: "v1 ist gesperrt. Änderungen landen in einem neuen Entwurf.",
    preisModus: "fest",
    renderer: "vps",
    ...extra,
  };
}

const LAEUFT: KvErzeugung = { art: "laeuft", seit: "2026-11-07T09:55:00.000Z" };
const LAEUFT_LANGE: KvErzeugung = { art: "laeuft", seit: new Date(JETZT.getTime() - KV_LANGE_MS).toISOString() };

function sperren(v: KalkulationsAnsicht["version"]): string {
  return renderToStaticMarkup(
    createElement(SperrenBereich, {
      dealId: "deal_weber",
      version: v,
      laeuft: null,
      onSperren: vi.fn(),
      onKv: vi.fn(),
      onNeueVersion: vi.fn(),
      onNeuRechnen: vi.fn(),
      jetzt: JETZT,
    })
  );
}

describe("kvStatus und kvKnopf (Entscheidung 5a-8)", () => {
  it("läuft: blauer Zustand mit Startzeit, kein zweites „KV erstellen“", () => {
    expect(kvStatus(version(LAEUFT), JETZT)).toEqual({
      ton: "blau",
      text: "KV wird erzeugt, gestartet 10:55. Die Seite aktualisiert sich von selbst.",
      dokumentId: null,
    });
    expect(kvKnopf(version(LAEUFT), JETZT)).toBeNull();
  });

  it("läuft ungewöhnlich lange: Hinweis und „KV neu erstellen“", () => {
    expect(kvLaeuftLange(LAEUFT_LANGE, JETZT)).toBe(true);
    expect(kvLaeuftLange(LAEUFT, JETZT)).toBe(false);
    expect(kvStatus(version(LAEUFT_LANGE), JETZT)?.text).toContain("dauert ungewöhnlich lange");
    expect(kvKnopf(version(LAEUFT_LANGE), JETZT)).toBe("KV neu erstellen");
  });

  it("läuft seit gestern: mit Tag", () => {
    const e: KvErzeugung = { art: "laeuft", seit: "2026-11-06T16:00:00.000Z" };
    expect(kvStatus(version(e), JETZT)?.text).toContain("gestartet Fr 06.11. 17:00");
  });

  it("fertig: grün mit Dateiname und Link aufs Dokument, kein Knopf", () => {
    const v = version({ art: "fertig", dealDocumentId: "doc_1", fileName: "KV-Weber.pdf" }, { kvDokument: DOK, kvErstellbar: false });
    expect(kvStatus(v, JETZT)).toEqual({ ton: "jade", text: "KV erstellt: KV-Weber.pdf", dokumentId: "doc_1" });
    expect(kvKnopf(v, JETZT)).toBeNull();
  });

  it("verworfen: „KV veraltet, neu erstellen“ (F4) mit Knopf", () => {
    const v = version({ art: "verworfen" });
    expect(kvStatus(v, JETZT)?.text).toMatch(/^KV veraltet, neu erstellen\./);
    expect(kvStatus(v, JETZT)?.ton).toBe("gold");
    expect(kvKnopf(v, JETZT)).toBe("KV neu erstellen");
  });

  it("fehler: Text aus der Ansicht, rose, „KV neu erstellen“", () => {
    const v = version({ art: "fehler", text: "Der KV konnte nicht erzeugt werden. Bitte den KV neu erstellen." });
    expect(kvStatus(v, JETZT)).toMatchObject({ ton: "rose", text: "Der KV konnte nicht erzeugt werden. Bitte den KV neu erstellen." });
    expect(kvKnopf(v, JETZT)).toBe("KV neu erstellen");
  });

  it("keins: wie bisher (Dokument → grün, sonst nichts), Knopf nur bei kvErstellbar", () => {
    expect(kvStatus(version({ art: "keins" }), JETZT)).toBeNull();
    expect(kvKnopf(version({ art: "keins" }), JETZT)).toBe("KV erstellen");
    expect(kvStatus(version({ art: "keins" }, { kvDokument: DOK, kvErstellbar: false }), JETZT)?.dokumentId).toBe("doc_1");
    expect(kvKnopf(version({ art: "keins" }, { kvErstellbar: false }), JETZT)).toBeNull();
  });

  it("Entwurf: nie ein KV-Zustand", () => {
    const v = version(LAEUFT, { status: "entwurf", bearbeitbar: true });
    expect(kvStatus(v, JETZT)).toBeNull();
    expect(kvKnopf(v, JETZT)).toBeNull();
  });

  it("keine Gedankenstriche in den Texten", () => {
    for (const e of [LAEUFT, LAEUFT_LANGE, { art: "verworfen" } as const]) {
      expect(kvStatus(version(e), JETZT)?.text).not.toMatch(/[—–]/);
    }
  });
});

describe("kvMarke", () => {
  it("je Zustand eine Marke, keins ohne", () => {
    expect(kvMarke(LAEUFT)).toEqual({ ton: "blau", text: "PDF wird erzeugt" });
    expect(kvMarke({ art: "fertig", dealDocumentId: "d", fileName: "f" })).toEqual({ ton: "jade", text: "PDF abgelegt" });
    expect(kvMarke({ art: "verworfen" })).toEqual({ ton: "gold", text: "PDF veraltet" });
    expect(kvMarke({ art: "fehler", text: "x" })).toEqual({ ton: "rose", text: "PDF fehlgeschlagen" });
    expect(kvMarke({ art: "keins" })).toBeNull();
  });
});

describe("eventBetrifftDeal", () => {
  it("Deal-ID als detail (alter Dialog) oder im Objekt; ohne Angabe lieber nachladen", () => {
    expect(eventBetrifftDeal("deal_weber", "deal_weber")).toBe(true);
    expect(eventBetrifftDeal("deal_anders", "deal_weber")).toBe(false);
    expect(eventBetrifftDeal({ dealRecordId: "deal_weber" }, "deal_weber")).toBe(true);
    expect(eventBetrifftDeal({ dealId: "deal_anders" }, "deal_weber")).toBe(false);
    expect(eventBetrifftDeal(undefined, "deal_weber")).toBe(true);
  });
});

describe("SperrenBereich gerendert (Kottke)", () => {
  it("läuft: Zustand sichtbar, kein „KV erstellen“, „+ Neue Version“ bleibt", () => {
    const html = sperren(version(LAEUFT));
    expect(html).toContain("KV wird erzeugt, gestartet 10:55");
    expect(html).toContain('data-ton="blau"');
    expect(html).not.toContain(">KV erstellen<");
    expect(html).toContain("+ Neue Version");
  });

  it("fertig: „KV öffnen“ auf das abgelegte Dokument", () => {
    const html = sperren(version({ art: "fertig", dealDocumentId: "doc_1", fileName: "KV-Weber.pdf" }, { kvDokument: DOK, kvErstellbar: false }));
    expect(html).toContain("KV erstellt: KV-Weber.pdf");
    expect(html).toContain('href="/api/v1/deals/deal_weber/documents/doc_1"');
    expect(html).not.toContain("KV neu erstellen");
  });

  it("verworfen: Hinweis und „KV neu erstellen“", () => {
    const html = sperren(version({ art: "verworfen" }));
    expect(html).toContain("KV veraltet, neu erstellen.");
    expect(html).toContain(">KV neu erstellen<");
  });

  it("CRM-Renderer ohne Job: wie bisher „KV erstellen“", () => {
    const html = sperren(version({ art: "keins" }, { renderer: "crm" }));
    expect(html).toContain(">KV erstellen<");
    expect(html).not.toContain('role="status"');
  });
});

describe("KvVorschau mit Marke", () => {
  it("zeigt die Marke nur mit Zustand", () => {
    const kv = { posten: [{ text: "Umzug", betragCent: 239000, herkunft: "" }], summeCent: 239000, vorschau: false, obergrenze: false };
    expect(renderToStaticMarkup(createElement(KvVorschau, { kv, kvFehler: null, erzeugung: LAEUFT }))).toContain("PDF wird erzeugt");
    expect(renderToStaticMarkup(createElement(KvVorschau, { kv, kvFehler: null, erzeugung: { art: "keins" } }))).not.toContain("kalk-kv-marke");
    expect(renderToStaticMarkup(createElement(KvVorschau, { kv, kvFehler: null }))).not.toContain("kalk-kv-marke");
  });
});

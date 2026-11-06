import { describe, expect, it } from "vitest";
import type { InboxEintrag, InboxFilter } from "@/lib/inbox-neu";
import {
  AVATAR_GRAU,
  FILTER_LEER,
  avatarFarbe,
  chipZahl,
  gruppieren,
  ersterHaupt,
  gespraechUnterzeile,
  gespraechUrl,
  handyUnterzeile,
  inboxUrl,
  keinLeadSetztStufe,
  kompaktPille,
  linkFolge,
  listenUnterzeile,
  schluesselAus,
  sucheAktiv,
  vornameAus,
} from "./inbox-logik";

function eintrag(teil: Partial<InboxEintrag> & { key: string }): InboxEintrag {
  return {
    dealId: teil.key.startsWith("deal:") ? teil.key.slice(5) : null,
    gespraechIds: ["c1"],
    name: "Familie Weber",
    kuerzel: "FW",
    kanal: "whatsapp",
    kanaele: ["whatsapp"],
    kleinanzeigen: false,
    vorschau: "Danke",
    vorschauPraefix: null,
    zeit: "2026-11-06T11:05:00.000Z",
    zeitText: "12:05",
    ungelesen: 0,
    wartet: { auf: "kunde", seit: null, text: "wartet auf Kunden · 2 Tage" },
    kiEntwurf: null,
    stufe: { id: "s-angebot", label: "Angebot", ton: "gold" },
    gruppe: "haupt",
    laneText: null,
    firma: { id: "f-kottke", name: "Kottke" },
    ...teil,
  };
}

const KURZ = {
  name: "Familie Weber",
  stufe: { id: "s-angebot", label: "Angebot", ton: "gold" as const },
  kunde: { telefon: null, email: null, von: null, nach: null, quelle: "Kleinanzeigen", firma: "Kottke" },
  keinLeadStufeId: "s-kein-lead",
  kategorie: "quoted",
};

describe("schluesselAus und URLs", () => {
  it("liest deal: und gespraech:", () => {
    expect(schluesselAus("deal:abc")).toEqual({ art: "deal", id: "abc" });
    expect(schluesselAus("gespraech:c-1:x")).toEqual({ art: "gespraech", id: "c-1:x" });
  });

  it("weist Unbekanntes ab", () => {
    expect(schluesselAus(null)).toBeNull();
    expect(schluesselAus("")).toBeNull();
    expect(schluesselAus("deal:")).toBeNull();
    expect(schluesselAus("person:1")).toBeNull();
    expect(schluesselAus("abc")).toBeNull();
  });

  it("baut die Gesprächsroute je Art", () => {
    expect(gespraechUrl({ art: "deal", id: "d1" })).toBe("/api/v1/deals/d1/gespraech");
    expect(gespraechUrl({ art: "gespraech", id: "c 1" })).toBe("/api/v1/inbox/gespraeche/c%201");
  });

  it("hält die Auswahl in ?e=", () => {
    expect(inboxUrl(null)).toBe("/app/inbox");
    expect(inboxUrl("deal:d1")).toBe("/app/inbox?e=deal%3Ad1");
  });

  it("nimmt am Desktop den ersten Eintrag der Hauptgruppe", () => {
    expect(ersterHaupt([eintrag({ key: "gespraech:i", gruppe: "info" }), eintrag({ key: "deal:a" })])).toBe("deal:a");
    expect(ersterHaupt([eintrag({ key: "gespraech:i", gruppe: "info" })])).toBeNull();
  });
});

describe("Texte", () => {
  it("Handy-Unterzeile mit Einzahl", () => {
    expect(handyUnterzeile({ ungelesen: 7, wartenAufUns: 4, kiEntwuerfe: 3, infoKeinLead: 3 })).toBe("4 warten auf uns · 7 ungelesen");
    expect(handyUnterzeile({ ungelesen: 0, wartenAufUns: 1, kiEntwuerfe: 0, infoKeinLead: 0 })).toBe("1 wartet auf uns · 0 ungelesen");
  });

  it("Listenkopf", () => {
    expect(listenUnterzeile(0, false)).toBe("Keine Gespräche");
    expect(listenUnterzeile(1, false)).toBe("1 Gespräch");
    expect(listenUnterzeile(11, false)).toBe("11 Gespräche");
    expect(listenUnterzeile(500, true)).toBe("500 Gespräche · nur die neuesten 500");
  });

  it("Unterzeile des Gesprächs: Stufe, Quelle, Wartet", () => {
    expect(gespraechUnterzeile(eintrag({ key: "deal:d1", wartet: { auf: "uns", seit: null, text: "wartet auf uns · 35 Min" } }), KURZ)).toBe(
      "Angebot · Kleinanzeigen · wartet auf uns · 35 Min"
    );
  });

  it("Unterzeile ohne Deal: Lane oder „Ohne Deal“, Quelle aus dem Eintrag", () => {
    expect(
      gespraechUnterzeile(
        eintrag({ key: "gespraech:c", stufe: null, laneText: "Kein Lead", gruppe: "info", kleinanzeigen: true, wartet: { auf: "niemand", seit: null, text: null } }),
        null
      )
    ).toBe("Kein Lead · Kleinanzeigen");
    expect(gespraechUnterzeile(eintrag({ key: "gespraech:c", stufe: null, wartet: { auf: "uns", seit: null, text: "wartet auf uns · 3 Std" } }), null)).toBe(
      "Ohne Deal · wartet auf uns · 3 Std"
    );
    expect(gespraechUnterzeile(null, null)).toBe("");
  });

  it("kürzt die Pillen fürs Handy", () => {
    expect(kompaktPille("wartet auf uns · 35 Min")).toBe("wartet · 35 Min");
    expect(kompaktPille("wartet auf Kunden · 2 Tage")).toBe("Kunde · 2 Tage");
    expect(kompaktPille("KV ungesehen · 4 Tage")).toBe("KV ungesehen");
    expect(kompaktPille("KI-Entwurf · Nachfass")).toBe("Nachfass");
    expect(kompaktPille("KI-Entwurf")).toBe("KI-Entwurf");
    expect(kompaktPille("läuft")).toBe("läuft");
  });

  it("liest Chip-Zähler", () => {
    const chips = { ungelesen: 7, wartenAufUns: 4, kiEntwuerfe: 3, infoKeinLead: 2 };
    expect(chipZahl(chips, "ungelesen")).toBe(7);
    expect(chipZahl(chips, "warten")).toBe(4);
    expect(chipZahl(chips, "ki")).toBe(3);
    expect(chipZahl(chips, "info")).toBe(2);
  });
});

describe("Schnellaktion „Link erneut senden“", () => {
  it("Vorname ohne Anrede und Titel", () => {
    expect(vornameAus("Anna Weber")).toBe("Anna");
    expect(vornameAus("Familie Weber")).toBeNull();
    expect(vornameAus("Dr. Kaiser")).toBeNull();
    expect(vornameAus("+49 170 …")).toBeNull();
    expect(vornameAus("")).toBeNull();
    expect(vornameAus(null)).toBeNull();
  });

  it("baut den KV-Baustein mit Link, Firma und Auftragsnummer", () => {
    const f = linkFolge({ url: "https://k.de/s/abc", dealNumber: "2026-003" }, { ...KURZ, name: "Anna Weber" });
    expect(f.art).toBe("text");
    if (f.art !== "text") return;
    expect(f.text).toContain("Hallo Anna,");
    expect(f.text).toContain("(Auftrag 2026-003)");
    expect(f.text).toContain("https://k.de/s/abc");
    expect(f.text).toContain("Viele Grüße\nKottke");
  });

  it("Hinweis bei Portal aus und ohne Link", () => {
    expect(linkFolge({ url: null, skipped: true }, KURZ)).toEqual({ art: "hinweis", text: "Kunden-Portal ist für diese Firma aus." });
    expect(linkFolge({ url: null }, KURZ).art).toBe("hinweis");
  });
});

describe("gruppieren", () => {
  const liste: InboxEintrag[] = [
    eintrag({ key: "deal:a", ungelesen: 1, wartet: { auf: "uns", seit: "2026-11-06T10:00:00Z", text: "wartet auf uns · 35 Min" } }),
    eintrag({ key: "deal:b", kanal: "email", kanaele: ["kleinanzeigen"], kleinanzeigen: true, kiEntwurf: { text: "KI-Entwurf" }, firma: { id: "f-ceylan", name: "Ceylan" } }),
    eintrag({ key: "deal:c", stufe: { id: "s-neu", label: "Neue Anfrage", ton: "blau" } }),
    eintrag({ key: "gespraech:i", gruppe: "info", laneText: "Info", stufe: null, ungelesen: 2, wartet: { auf: "niemand", seit: null, text: null } }),
  ];
  const f = (teil: Partial<InboxFilter>): InboxFilter => ({ ...FILTER_LEER, ...teil });

  it("trennt Haupt- und Info-Gruppe ohne Filter", () => {
    const g = gruppieren(liste, FILTER_LEER);
    expect(g.haupt.map((e) => e.key)).toEqual(["deal:a", "deal:b", "deal:c"]);
    expect(g.info.map((e) => e.key)).toEqual(["gespraech:i"]);
  });

  it("Chips: ungelesen nur in der Hauptgruppe, warten, ki, info", () => {
    expect(gruppieren(liste, f({ chip: "ungelesen" })).haupt.map((e) => e.key)).toEqual(["deal:a"]);
    expect(gruppieren(liste, f({ chip: "warten" })).haupt.map((e) => e.key)).toEqual(["deal:a"]);
    expect(gruppieren(liste, f({ chip: "ki" })).haupt.map((e) => e.key)).toEqual(["deal:b"]);
    const info = gruppieren(liste, f({ chip: "info" }));
    expect(info.haupt.map((e) => e.key)).toEqual(["gespraech:i"]);
    expect(info.info).toEqual([]);
  });

  it("Leiste: Kanal, Kleinanzeigen, Firma, Stufe, Schalter", () => {
    expect(gruppieren(liste, f({ kanal: "email" })).haupt.map((e) => e.key)).toEqual([]);
    expect(gruppieren(liste, f({ kanal: "kleinanzeigen" })).haupt.map((e) => e.key)).toEqual(["deal:b"]);
    expect(gruppieren(liste, f({ kanal: "whatsapp" })).haupt.map((e) => e.key)).toEqual(["deal:a", "deal:c"]);
    expect(gruppieren(liste, f({ firmaId: "f-ceylan" })).haupt.map((e) => e.key)).toEqual(["deal:b"]);
    expect(gruppieren(liste, f({ stufeId: "s-neu" })).haupt.map((e) => e.key)).toEqual(["deal:c"]);
    expect(gruppieren(liste, f({ nurWartet: true })).haupt.map((e) => e.key)).toEqual(["deal:a"]);
    expect(gruppieren(liste, f({ nurWartet: true })).info).toEqual([]);
  });

  it("Suche hebt Gruppe und Chips auf, die Leiste bleibt", () => {
    const g = gruppieren(liste, f({ suche: "we", chip: "ki", kanal: "whatsapp" }));
    expect(g.haupt.map((e) => e.key)).toEqual(["deal:a", "deal:c", "gespraech:i"]);
    expect(g.info).toEqual([]);
    expect(sucheAktiv(" w ")).toBe(false);
    expect(sucheAktiv("we")).toBe(true);
  });
});

describe("Kurzfassung", () => {
  it("„Kein Lead“ setzt die Stufe nur bei offenen Deals", () => {
    expect(keinLeadSetztStufe({ keinLeadStufeId: "s", kategorie: "quoted" })).toBe(true);
    expect(keinLeadSetztStufe({ keinLeadStufeId: "s", kategorie: null })).toBe(true);
    expect(keinLeadSetztStufe({ keinLeadStufeId: "s", kategorie: "booked" })).toBe(false);
    expect(keinLeadSetztStufe({ keinLeadStufeId: "s", kategorie: "paid" })).toBe(false);
    expect(keinLeadSetztStufe({ keinLeadStufeId: null, kategorie: "quoted" })).toBe(false);
  });

  it("Avatarfarbe stabil je Name, grau in der Info-Gruppe", () => {
    expect(avatarFarbe("Familie Weber", "haupt")).toBe(avatarFarbe("Familie Weber", "haupt"));
    expect(avatarFarbe("Familie Weber", "haupt")).toMatch(/^#[0-9a-f]{6}$/);
    expect(avatarFarbe("Sixt", "info")).toBe(AVATAR_GRAU);
  });
});

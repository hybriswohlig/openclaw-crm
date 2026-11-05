import { describe, expect, it } from "vitest";
import { CEYLAN_BRANDING, KOTTKE_BRANDING } from "@openclaw-crm/customer-portal-core";
import {
  briefAnrede,
  briefEinleitung,
  briefZustand,
  grussZeilen,
  stempel,
  terminVorbeiHinweis,
  terminVorbeiNachricht,
  vorgangsSchritte,
  type BriefZustand,
} from "../app/(public)/s/[token]/_components/brief";
import { adressZeilen } from "../app/(public)/s/[token]/_components/leistung-worte";

describe("Brief im Portal", () => {
  it("spricht mit Namen an und lässt ohne Namen keinen leeren Platz", () => {
    expect(briefAnrede("Max Berger")).toBe("Guten Tag Max Berger,");
    expect(briefAnrede(null)).toBe("Guten Tag,");
    expect(briefAnrede("   ")).toBe("Guten Tag,");
  });

  it("leitet den Zustand ab, eine Annahme schlägt den Ablauf", () => {
    expect(briefZustand({ angenommen: false, unterschrieben: false, abgelaufen: false })).toBe("offen");
    expect(briefZustand({ angenommen: false, unterschrieben: false, abgelaufen: true })).toBe("abgelaufen");
    expect(briefZustand({ angenommen: true, unterschrieben: false, abgelaufen: true })).toBe("angenommen");
    expect(briefZustand({ angenommen: true, unterschrieben: true, abgelaufen: false })).toBe("unterschrieben");
  });

  it("schreibt die Einleitung je Zustand", () => {
    expect(briefEinleitung("offen", "Freitag, 20. November 2026", null)).toBe(
      "hier ist Ihr Festpreis für den Umzug am Freitag, 20. November 2026. Wenn alles passt, nehmen Sie das Angebot unten an.",
    );
    expect(briefEinleitung("offen", null, null)).toBe(
      "hier ist Ihr Festpreis für den Umzug. Wenn alles passt, nehmen Sie das Angebot unten an.",
    );
    expect(briefEinleitung("abgelaufen", null, null)).toBe(
      "dieses Angebot ist abgelaufen. Schreiben Sie uns kurz, dann schicken wir Ihnen ein aktuelles.",
    );
    expect(briefEinleitung("angenommen", null, "23. Oktober 2026")).toBe(
      "vielen Dank, Sie haben das Angebot am 23. Oktober 2026 angenommen. Die Auftragsbestätigung folgt nach unserer Einsatzplanung.",
    );
    expect(briefEinleitung("unterschrieben", null, "23. Oktober 2026")).toBe(
      "vielen Dank, Sie haben das Angebot am 23. Oktober 2026 angenommen. Die Auftragsbestätigung folgt nach unserer Einsatzplanung. Ihren unterschriebenen Vertrag finden Sie unten.",
    );
  });

  it("grüßt mit Ansprechpartner oder vom Team", () => {
    expect(grussZeilen(KOTTKE_BRANDING)).toEqual({ gruss: "Herzliche Grüße", name: "Dario Kottke", rolle: "Inhaber" });
    expect(grussZeilen(CEYLAN_BRANDING)).toEqual({
      gruss: "Herzliche Grüße",
      name: "Ihr Team von Ceylan Umzüge & Transporte",
      rolle: null,
    });
  });

  it("stempelt nur, was wirklich passiert ist", () => {
    expect(stempel({ signedAt: null, unterschriftAt: null })).toEqual([]);
    expect(stempel({ signedAt: "2026-10-23T10:58:00Z", unterschriftAt: null })).toEqual([
      { art: "angenommen", datum: "23.10.2026" },
    ]);
    expect(stempel({ signedAt: "2026-10-23T10:58:00Z", unterschriftAt: "2026-10-23T10:59:00Z" })).toEqual([
      { art: "angenommen", datum: "23.10.2026" },
      { art: "unterschrieben", datum: "23.10.2026" },
    ]);
    // 23:30 UTC ist in Berlin schon der nächste Tag.
    expect(stempel({ signedAt: "2026-10-23T23:30:00Z", unterschriftAt: null })[0].datum).toBe("24.10.2026");
  });

  it("zeigt beim Umzug Abholung und Ziel, bei Küche und Entrümpelung nur einen Ort", () => {
    const scope = { fromAddress: "Teststraße 1", toAddress: "Beispielweg 2", floorsFrom: 0, floorsTo: 3, accessFrom: null, accessTo: "Aufzug" };
    const mit = (leistung: "move" | "kitchen_installation" | "clearance" | "clearance_move", s: Partial<typeof scope> = {}) =>
      adressZeilen({ leistung, branding: KOTTKE_BRANDING, scope: { ...scope, ...s } as never }).map((z) => [z.label, z.adresse]);
    expect(mit("move")).toEqual([["Abholung", "Teststraße 1"], ["Ziel", "Beispielweg 2"]]);
    expect(mit("clearance_move")).toEqual([["Abholung", "Teststraße 1"], ["Ziel", "Beispielweg 2"]]);
    expect(mit("kitchen_installation")).toEqual([["Montageort", "Beispielweg 2"]]);
    expect(mit("clearance")).toEqual([["Einsatzort", "Teststraße 1"]]);
    expect(mit("kitchen_installation", { toAddress: "  " })).toEqual([["Montageort", "Teststraße 1"]]);
    expect(mit("move", { fromAddress: "  ", toAddress: null as never })).toEqual([]);
  });

  it("nennt im Brief die richtige Leistung", () => {
    expect(briefEinleitung("offen", "Montag, 30. November 2026", null, "kitchen_installation", "kottke")).toContain("für die Küchenmontage am");
    expect(briefEinleitung("offen", "Montag, 30. November 2026", null, "clearance_move", "kottke")).toContain("für die Entrümpelung und den Umzug am");
  });

  it("schreibt keine Gedankenstriche", () => {
    const zustaende: BriefZustand[] = ["offen", "abgelaufen", "angenommen", "unterschrieben"];
    const texte = [
      ...zustaende.map((z) => briefEinleitung(z, "Freitag, 20. November 2026", "23. Oktober 2026")),
      briefAnrede("Max Berger"),
      grussZeilen(CEYLAN_BRANDING).name ?? "",
    ];
    for (const t of texte) expect(t).not.toMatch(/[—–]/);
  });

  it("ordnet die Vorgangszeile und hängt das Annahmedatum an „Annahme“", () => {
    const T = ["Angebot", "Annahme", "Bestätigung", "Umzug"];
    expect(vorgangsSchritte({ titel: T, aktuellIndex: 0, angenommenAm: null }).map((s) => s.zustand)).toEqual([
      "aktuell",
      "offen",
      "offen",
      "offen",
    ]);
    expect(vorgangsSchritte({ titel: T, aktuellIndex: 0, angenommenAm: null }).every((s) => s.datum === null)).toBe(true);
    expect(vorgangsSchritte({ titel: T, aktuellIndex: 1, angenommenAm: "23.10.2026" })).toEqual([
      { titel: "Angebot", zustand: "erledigt", datum: null },
      { titel: "Annahme", zustand: "aktuell", datum: "23.10.2026" },
      { titel: "Bestätigung", zustand: "offen", datum: null },
      { titel: "Umzug", zustand: "offen", datum: null },
    ]);
    expect(vorgangsSchritte({ titel: T, aktuellIndex: 2, angenommenAm: "23.10.2026" })[1]).toEqual({
      titel: "Annahme",
      zustand: "erledigt",
      datum: "23.10.2026",
    });
  });

  it("Kottke duzt, Ceylan bleibt beim Sie", () => {
    expect(briefEinleitung("offen", "Freitag, 20. November 2026", null, "move", "kottke")).toBe(
      "hier ist dein Festpreis für den Umzug am Freitag, 20. November 2026. Wenn alles passt, nimm das Angebot unten an.",
    );
    expect(briefEinleitung("angenommen", null, "23. Oktober 2026", "move", "kottke")).toContain("du hast das Angebot");
    expect(briefEinleitung("unterschrieben", null, "23. Oktober 2026", "move", "kottke")).toContain("Deinen unterschriebenen Vertrag findest du unten.");
    expect(briefEinleitung("offen", null, null, "move", "ceylan")).toContain("nehmen Sie das Angebot unten an.");
    expect(terminVorbeiHinweis("kottke")).toContain("Möchtest du");
    expect(terminVorbeiHinweis("ceylan")).toContain("Möchten Sie");
    expect(terminVorbeiHinweis("kottke")).not.toMatch(/\b(Sie|Ihnen)\b/);
  });

  it("nennt die tatsächliche Leistung statt immer „Umzug“", () => {
    expect(briefEinleitung("offen", "Freitag, 20. November 2026", null, "kitchen_installation")).toBe(
      "hier ist Ihr Festpreis für die Küchenmontage am Freitag, 20. November 2026. Wenn alles passt, nehmen Sie das Angebot unten an.",
    );
    expect(briefEinleitung("offen", null, null, "clearance")).toBe(
      "hier ist Ihr Festpreis für die Entrümpelung. Wenn alles passt, nehmen Sie das Angebot unten an.",
    );
    expect(briefEinleitung("offen", null, null, null)).toBe(
      "hier ist Ihr Festpreis für Ihren Auftrag. Wenn alles passt, nehmen Sie das Angebot unten an.",
    );
  });
});

// Termin vorbei, Angebot nie angenommen: kein „abgelaufen, neues Angebot“,
// sondern der Hinweis auf den vergangenen Termin.
describe("Termin vorbei", () => {
  it("Zustand termin_vorbei vor abgelaufen, nach angenommen", () => {
    expect(briefZustand({ angenommen: false, unterschrieben: false, abgelaufen: true, terminVorbei: true })).toBe("termin_vorbei");
    expect(briefZustand({ angenommen: true, unterschrieben: false, abgelaufen: false, terminVorbei: true })).toBe("angenommen");
  });
  it("Einleitung nennt den vergangenen Termin", () => {
    const text = briefEinleitung("termin_vorbei", "12. Oktober 2026", null, "move");
    expect(text).toContain("Termin");
    expect(text).not.toContain("abgelaufen");
  });
  it("WhatsApp-Nachricht fragt nach einem neuen Termin", () => {
    const text = terminVorbeiNachricht("Kottke Umzüge", "2026-123");
    expect(text).toContain("Auftrag 2026-123");
    expect(text).toContain("neuen Termin");
  });
});

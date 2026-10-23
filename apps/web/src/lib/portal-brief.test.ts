import { describe, expect, it } from "vitest";
import { CEYLAN_BRANDING, KOTTKE_BRANDING } from "@openclaw-crm/customer-portal-core";
import {
  briefAnrede,
  briefEinleitung,
  briefZustand,
  grussZeilen,
  stempel,
  strecke,
  vorgangsSchritte,
  type BriefZustand,
} from "../app/(public)/s/[token]/_components/brief";

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

  it("zeigt die Strecke nur mit beiden Adressen als Linie", () => {
    expect(strecke("Teststraße 1", "Beispielweg 2")).toEqual({
      zeilen: [
        { label: "Von", adresse: "Teststraße 1" },
        { label: "Nach", adresse: "Beispielweg 2" },
      ],
      mitLinie: true,
    });
    expect(strecke(null, "Beispielweg 2")).toEqual({ zeilen: [{ label: "Nach", adresse: "Beispielweg 2" }], mitLinie: false });
    expect(strecke("  ", null)).toBeNull();
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

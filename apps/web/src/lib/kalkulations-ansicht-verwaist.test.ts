import { describe, expect, it } from "vitest";
import { verwaisteZeilenUebersteuerungen } from "./angebot-wahl";
import { ansichtAus, verwaistMitNamen } from "./kalkulations-ansicht";
import { ALT, NEU, UUID, uuidVersion } from "./kalkulations-ansicht-verwaist.fixture";

function namen(v: ReturnType<typeof uuidVersion>) {
  return verwaistMitNamen(verwaisteZeilenUebersteuerungen(v.overrides, v.rechnerResult?.kosten?.posten ?? []), v);
}

describe("verwaistMitNamen (Plan 5a, UUID-Schlüssel)", () => {
  it("Klassenname aus dem Kandidaten, alte Station „einer früheren Station“, Kandidat mit Stationsname", () => {
    const [x] = namen(uuidVersion());
    expect(x).toMatchObject({
      id: "u_verwaist",
      key: ALT,
      kandidaten: [NEU],
      wert: 120,
      text: "Sprinter L, Miete an einer früheren Station: 120 €",
      kandidatenText: ["Sprinter L, Miete an Sixt Feuerbach"],
      kandidatenStation: ["Sixt Feuerbach"],
    });
  });

  it("ohne Mietstation im Ergebnis „der aktuellen Station“", () => {
    const [x] = namen(uuidVersion({ mietstation: false }));
    expect(x.kandidatenText).toEqual(["Sprinter L, Miete an der aktuellen Station"]);
    expect(x.kandidatenStation).toEqual(["der aktuellen Station"]);
  });

  it("ohne Zeile derselben Klasse heißt das Fahrzeug „Fahrzeug“", () => {
    const v = uuidVersion();
    v.rechnerResult!.kosten!.posten = (v.rechnerResult!.kosten!.posten ?? []).filter((p) => !p.key?.startsWith("fahrzeug."));
    const [x] = namen(v);
    expect(x.text).toBe("Fahrzeug, Miete an einer früheren Station: 120 €");
    expect(x.kandidaten).toEqual([]);
  });

  it("nie eine UUID in Text, Kandidaten-Text, Station oder Anpassungsliste", () => {
    for (const v of [uuidVersion(), uuidVersion({ mietstation: false })]) {
      const a = ansichtAus(v, {
        alle: [{ version: 2, status: "entwurf", priceCents: null }], namen: {},
        deal: { name: "Weber", art: "Umzug", strecke: "", termin: null, aktenLink: "/" },
        inventar: [], fotos: [], vorlagen: [], angebot: null, veraltet: false, kvDokument: null, jetzt: new Date(),
      });
      const [x] = namen(v);
      for (const t of [x.text, ...x.kandidatenText, ...x.kandidatenStation]) expect(t).not.toMatch(UUID);
      for (const z of a.anpassungen) expect(z.text).not.toMatch(UUID);
      expect(a.anpassungen.find((z) => z.id === "u_verwaist")?.text).toContain("Sprinter L, Miete an einer früheren Station: 120 €");
    }
  });
});

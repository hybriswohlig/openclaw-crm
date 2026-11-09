import { describe, expect, it } from "vitest";
import type { RechnerErgebnis } from "@/services/rechner/client";
import { inventarListe, type InventarQuelle } from "./kalkulation-inventar";

const z = (name: string, extra: Partial<InventarQuelle> = {}): InventarQuelle => ({
  id: `it_${name}`, name, quantity: 1, moveFlag: true, source: "foto", photoAttachmentId: null, volumeCbmEstimate: null,
  dismantlingOwner: "none", assemblyOwner: "none", ...extra,
});

const e: RechnerErgebnis = {
  team: { groesse: 3, quelle: "traeger" },
  positionen: [
    { positionId: "p1", name: "Eckbank", menge: 1, volumenCbm: 2, gewichtKg: 120, zerlegt: false, ungeprueft: true },
    { positionId: "p2", name: "Bett", menge: 2, volumenCbm: 1.2, gewichtKg: 70, zerlegt: true, ungeprueft: false },
  ],
  positionenDetails: [
    { positionId: "p1", katalogKey: null, katalogTreffer: false, groessenklasse: "sperrig", mindestTraeger: 3, trageMin: 50, demontageMin: null, montageMin: null },
    { positionId: "p2", katalogKey: "bett_180", katalogTreffer: true, groessenklasse: "gross", mindestTraeger: 2, trageMin: 16, demontageMin: 30, montageMin: 45 },
  ],
};

describe("inventarListe (Bauteil 14)", () => {
  it("verbindet Inventar und Rechner, markiert ohne Katalog und das Team-Teil", () => {
    const l = inventarListe(
      [z("Eckbank", { photoAttachmentId: "att_1" }), z("Bett", { quantity: 2, dismantlingOwner: "company", assemblyOwner: "customer", source: "chat" }), z("Gartengrill", { moveFlag: false })],
      e,
      { korrekturen: { it_Bett: { von: "Dario", am: "09.11. 10:00" } } }
    );
    const [eck, bett, grill] = l.zeilen;
    expect(eck).toMatchObject({ katalog: { treffer: false, key: null }, groessenklasse: "sperrig", mindestTraeger: 3, bestimmtTeam: true, fotoUrl: "/api/v1/inbox/attachments/att_1/content", herkunft: "FOTO" });
    expect(bett).toMatchObject({
      katalog: { treffer: true, key: "bett_180" }, herkunft: "CHAT", trageMin: 16,
      demontage: { min: 30, wer: "wir" }, montage: { min: 45, wer: "kunde" }, bestimmtTeam: false, korrigiert: { von: "Dario", am: "09.11. 10:00" },
    });
    expect(grill).toMatchObject({ mitnehmen: false, katalog: null, positionen: 0 });
    expect(l.stueck).toBe(3);
    expect(l.erklaerung).toBe("2 Zeilen mit zusammen 3 Stück (Menge je Zeile); der Rechner rechnet 2 Positionen (Sammelzeilen geteilt, Küchen nicht als Stück); 1 ohne Katalogtreffer.");
  });
});

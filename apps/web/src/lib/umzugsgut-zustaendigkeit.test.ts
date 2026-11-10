import { describe, expect, it } from "vitest";
import { umzugsgutZustaendigkeit } from "./umzugsgut-zustaendigkeit";

const z = (name: string, d = "none", a = "none") => ({ name, dismantlingOwner: d, assemblyOwner: a });

describe("umzugsgutZustaendigkeit (KV-Meldung 10.11., Viktoriia)", () => {
  // Nachbau der Lage: Rechner zerlegt nach Regel, Anfrage ohne abbau/aufbau, Lead überall „none“.
  const anfrage = {
    montage_je_position: "1",
    positionen_freitext: [
      { name: "Doppelbett mit Polsterkopfteil", menge: 1 },
      { name: "Esstisch dunkel ausziehbar", menge: 1 },
      { name: "Sitzbank dunkel", menge: 1 },
    ],
  };
  const ergebnis = {
    positionen: [
      { name: "Doppelbett mit Polsterkopfteil", menge: 1, volumenCbm: 1.6, zerlegt: true },
      { name: "Esstisch dunkel ausziehbar", menge: 1, volumenCbm: 0.8, zerlegt: true },
      { name: "Sitzbank dunkel", menge: 1, volumenCbm: 0.4, zerlegt: false },
    ],
  };
  const zeilen = [z("Doppelbett mit Polsterkopfteil"), z("Esstisch  dunkel ausziehbar"), z("Sitzbank dunkel")];

  it("zerlegt nach Regel: wir bauen ab und auf, sonst „Nicht vorgesehen“", () => {
    expect(umzugsgutZustaendigkeit(zeilen, { anfrage, ergebnis }, { dismantling: { owner: "company" }, assembly: { owner: "company" } })).toEqual([
      { dismantling: "company", assembly: "company" },
      { dismantling: "company", assembly: "company" },
      { dismantling: "none", assembly: "none" },
    ]);
  });

  it("vorher (nur Lead-Spalten) stand überall „none“: ohne Kalkulation bleibt es beim Lead", () => {
    expect(umzugsgutZustaendigkeit(zeilen, null)).toEqual(zeilen.map(() => ({ dismantling: "none", assembly: "none" })));
    expect(umzugsgutZustaendigkeit([z("Bett", "customer", "company")], null)).toEqual([{ dismantling: "customer", assembly: "company" }]);
  });

  it("Montage weggelassen (Leistungen beim Kunden): zerlegte Möbel beim Kunden", () => {
    const r = umzugsgutZustaendigkeit(zeilen, { anfrage, ergebnis }, { dismantling: { owner: "customer" }, assembly: { owner: "customer" } });
    expect(r[0]).toEqual({ dismantling: "customer", assembly: "customer" });
    expect(r[2]).toEqual({ dismantling: "none", assembly: "none" });
  });

  it("Wahl je Position in der Anfrage gilt genau, fehlende Seite ist „none“", () => {
    const mitWahl = {
      montage_je_position: "1",
      positionen_freitext: [
        { name: "Doppelbett mit Polsterkopfteil", menge: 1, abbau: "customer", aufbau: "company" },
        { name: "Esstisch dunkel ausziehbar", menge: 1, abbau: "company" },
        { name: "Sitzbank dunkel", menge: 1, abbau: "none", aufbau: "none" },
      ],
    };
    expect(umzugsgutZustaendigkeit(zeilen, { anfrage: mitWahl, ergebnis })).toEqual([
      { dismantling: "customer", assembly: "company" },
      { dismantling: "company", assembly: "none" },
      { dismantling: "none", assembly: "none" },
    ]);
  });

  it("alte Version ohne Schalter: Wahl in der Anfrage zählt nicht, Kunde aus dem Lead bleibt", () => {
    const alt = { positionen_freitext: [{ name: "Sitzbank dunkel", menge: 1, abbau: "company", aufbau: "company" }] };
    expect(umzugsgutZustaendigkeit([z("Sitzbank dunkel", "customer", "none"), z("Doppelbett mit Polsterkopfteil")], { anfrage: alt, ergebnis })).toEqual([
      { dismantling: "customer", assembly: "none" },
      { dismantling: "company", assembly: "company" },
    ]);
  });
});

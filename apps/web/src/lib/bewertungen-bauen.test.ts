import { describe, expect, it } from "vitest";
import { ANKER_VERZUG_MS, BACKFILL_STICHTAG, type BewertungListe } from "@/lib/bewertungen-kunden";
import { bewertungZeilen, zaehlerAus, type BewertungZeileRoh } from "@/lib/bewertungen-bauen";

const jetzt = new Date("2026-11-08T12:00:00.000Z");

function roh(teil: Partial<BewertungZeileRoh> & Pick<BewertungZeileRoh, "dealId">): BewertungZeileRoh {
  return {
    stufe: "paid",
    statusTitel: null,
    nichtKontaktieren: false,
    nichtKontaktierenSeit: null,
    token: null,
    vormerkung: null,
    hatPerson: true,
    hatGoogleLink: true,
    kontaktart: "lead_kunde",
    titel: "Umzug",
    dealNummer: "2026-014",
    kunde: { personId: "p1", name: "Anna Berger" },
    firma: { id: "oc", name: "Kottke Umzüge", marke: "kottke" },
    angefragtAm: null,
    vormerkungId: null,
    anker: null,
    ...teil,
  };
}

const LISTEN: BewertungListe[] = ["freigabe", "vorgemerkt", "faellig", "angefragt", "geklickt", "gesperrt"];

describe("bewertungZeilen", () => {
  it("ordnet jede Lage zu und lässt Altsperren aus den Zeilen", () => {
    const anker = new Date("2026-11-06T12:00:00.000Z");
    const fenster = new Date("2026-11-09T08:00:00.000Z");
    const geklickt = new Date("2026-11-07T15:00:00.000Z");
    const angefragt = new Date("2026-11-07T10:00:00.000Z");
    const zeilen = bewertungZeilen(
      [
        roh({
          dealId: "freigabe",
          vormerkung: { art: "entwurf", status: "offen", faelligAb: fenster, sperre: null },
          vormerkungId: "v-entwurf",
          anker,
        }),
        roh({
          dealId: "vorgemerkt",
          vormerkung: { art: "auto", status: "offen", faelligAb: fenster, sperre: null },
          vormerkungId: "v-auto",
          anker,
        }),
        roh({ dealId: "faellig", anker }),
        roh({ dealId: "faellig-ohne-anker" }),
        roh({
          dealId: "angefragt",
          token: { zustand: "gesendet", createdAt: angefragt, clickedAt: null, quelle: "hand" },
          angefragtAm: angefragt,
          vormerkung: { art: "auto", status: "gesendet", faelligAb: fenster, sperre: null },
        }),
        roh({
          dealId: "geklickt",
          token: { zustand: "gesendet", createdAt: angefragt, clickedAt: geklickt, quelle: "automatik" },
        }),
        roh({
          dealId: "unklar",
          token: { zustand: "unklar", createdAt: angefragt, clickedAt: null, quelle: "alt" },
        }),
        roh({
          dealId: "anspruch-alt",
          token: { zustand: "anspruch", createdAt: new Date(jetzt.getTime() - 11 * 60 * 1000), clickedAt: null, quelle: "hand" },
        }),
        roh({
          dealId: "altsperre",
          nichtKontaktieren: true,
          nichtKontaktierenSeit: new Date(BACKFILL_STICHTAG.getTime() - 86_400_000),
        }),
        roh({
          dealId: "gesperrt-neu",
          nichtKontaktieren: true,
          nichtKontaktierenSeit: new Date("2026-06-01T00:00:00.000Z"),
        }),
      ],
      jetzt
    );

    const id = (dealId: string) => zeilen.find((z) => z.dealId === dealId);
    expect(zeilen.map((z) => z.dealId)).not.toContain("altsperre");

    expect(id("freigabe")).toMatchObject({
      liste: "freigabe",
      grund: null,
      faelligAb: fenster.toISOString(),
      quelle: "entwurf",
      vormerkungId: "v-entwurf",
      tokenFreigebbar: false,
    });
    expect(id("vorgemerkt")).toMatchObject({
      liste: "vorgemerkt",
      faelligAb: fenster.toISOString(),
      quelle: "auto",
      vormerkungId: "v-auto",
    });
    expect(id("faellig")).toMatchObject({
      liste: "faellig",
      grund: null,
      faelligAb: new Date(anker.getTime() + ANKER_VERZUG_MS).toISOString(),
    });
    expect(id("faellig-ohne-anker")?.faelligAb).toBeNull();
    expect(id("angefragt")).toMatchObject({
      liste: "angefragt",
      quelle: "hand",
      angefragtAm: angefragt.toISOString(),
      geklicktAm: null,
      tokenFreigebbar: false,
    });
    expect(id("geklickt")).toMatchObject({
      liste: "geklickt",
      geklicktAm: geklickt.toISOString(),
      quelle: "automatik",
      tokenFreigebbar: false,
    });
    expect(id("unklar")).toMatchObject({
      liste: "gesperrt",
      grund: "VERSAND_UNKLAR",
      quelle: "alt",
      tokenFreigebbar: true,
    });
    expect(id("anspruch-alt")).toMatchObject({ liste: "gesperrt", grund: "VERSAND_UNKLAR", tokenFreigebbar: true });
    expect(id("gesperrt-neu")).toMatchObject({ liste: "gesperrt", grund: "NICHT_KONTAKTIEREN", tokenFreigebbar: false });
  });
});

describe("zaehlerAus", () => {
  it("hat immer alle sechs Schlüssel", () => {
    const zeilen = bewertungZeilen(
      [
        roh({ dealId: "a", vormerkung: { art: "entwurf", status: "offen", faelligAb: jetzt, sperre: null }, vormerkungId: "v" }),
        roh({ dealId: "b" }),
      ],
      jetzt
    );
    const z = zaehlerAus(zeilen);
    expect(Object.keys(z).sort()).toEqual([...LISTEN].sort());
    expect(z.freigabe).toBe(1);
    expect(z.faellig).toBe(1);
    expect(z.vorgemerkt).toBe(0);
    expect(z.angefragt).toBe(0);
    expect(z.geklickt).toBe(0);
    expect(z.gesperrt).toBe(0);
    expect(zaehlerAus([])).toEqual({
      freigabe: 0,
      vorgemerkt: 0,
      faellig: 0,
      angefragt: 0,
      geklickt: 0,
      gesperrt: 0,
    });
  });
});

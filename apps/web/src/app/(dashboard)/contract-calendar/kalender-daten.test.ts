import { describe, expect, it } from "vitest";
import { SEITENGROESSE, alleSeitenLaden } from "./kalender-daten";

/** Records-API wie im Betrieb: höchstens 200 pro Abruf, total über alles. */
function api(anzahl: number) {
  const alle = Array.from({ length: anzahl }, (_, i) => ({ id: `deal-${i}` }));
  const offsets: number[] = [];
  const ladeSeite = async (offset: number) => {
    offsets.push(offset);
    return { records: alle.slice(offset, offset + SEITENGROESSE), total: anzahl };
  };
  return { offsets, ladeSeite };
}

describe("alleSeitenLaden", () => {
  it("lädt alle 328 Aufträge in Schritten von 200", async () => {
    const { offsets, ladeSeite } = api(328);
    const r = await alleSeitenLaden(ladeSeite);
    expect(offsets).toEqual([0, 200]);
    expect(r.vollstaendig).toBe(true);
    expect(r.records).toHaveLength(328);
    expect(r.records.at(-1)?.id).toBe("deal-327");
  });

  it("braucht bei genau einer vollen Seite nur einen Abruf", async () => {
    const { offsets, ladeSeite } = api(200);
    const r = await alleSeitenLaden(ladeSeite);
    expect(offsets).toEqual([0]);
    expect(r.records).toHaveLength(200);
  });

  it("kommt ohne Aufträge mit einem Abruf aus", async () => {
    const { offsets, ladeSeite } = api(0);
    expect(await alleSeitenLaden(ladeSeite)).toEqual({ records: [], vollstaendig: true });
    expect(offsets).toEqual([0]);
  });

  it("behält bei einem Fehler die bisherigen Seiten und meldet unvollständig", async () => {
    const { ladeSeite } = api(450);
    const r = await alleSeitenLaden(async (offset) => (offset === 400 ? null : ladeSeite(offset)));
    expect(r.vollstaendig).toBe(false);
    expect(r.records).toHaveLength(400);
  });

  it("zeigt einen Auftrag nur einmal, wenn er auf zwei Seiten auftaucht", async () => {
    const offsets: number[] = [];
    const r = await alleSeitenLaden(async (offset) => {
      offsets.push(offset);
      const start = offset === 0 ? 0 : offset - 1; // Seite 2 beginnt mit dem letzten von Seite 1
      const records = Array.from({ length: Math.min(SEITENGROESSE, 250 - start) }, (_, i) => ({ id: `deal-${start + i}` }));
      return { records, total: 250 };
    });
    expect(offsets).toEqual([0, 200]);
    expect(new Set(r.records.map((d) => d.id)).size).toBe(r.records.length);
    expect(r.records).toHaveLength(250);
  });

  it("hört auf, wenn eine Seite leer bleibt, obwohl total mehr verspricht", async () => {
    const { ladeSeite } = api(150);
    const r = await alleSeitenLaden(async (offset) => ({ ...(await ladeSeite(offset)), total: 300 }));
    expect(r).toMatchObject({ vollstaendig: true });
    expect(r.records).toHaveLength(150);
  });

  it("bricht nach 50 Seiten ab", async () => {
    let aufrufe = 0;
    const r = await alleSeitenLaden(async (offset) => {
      aufrufe++;
      return { records: Array.from({ length: SEITENGROESSE }, (_, i) => ({ id: `deal-${offset + i}` })), total: 1_000_000 };
    });
    expect(aufrufe).toBe(50);
    expect(r.vollstaendig).toBe(false);
  });
});

import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { base64Groesse, cacheLesen, cacheSchreiben, crewFotoUmwandeln, FOTO_EINGANG_MAX_BYTES } from "./bild";

const bild = (w: number, h: number, o: { orientation?: number; png?: boolean } = {}) => {
  const s = sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 120, b: 200 } } });
  return (o.png ? s.png() : s.jpeg())
    .withMetadata({ ...(o.orientation ? { orientation: o.orientation } : {}), exif: { IFD0: { Copyright: "Familie Geheim", Make: "Kamera" } } })
    .toBuffer();
};

describe("Crew-Foto neu kodieren", () => {
  it("WebP ohne EXIF, nach Ausrichtung gedreht, lange Kante ≤ 1000", async () => {
    const ein = await bild(4000, 3000, { orientation: 6 });
    expect((await sharp(ein).metadata()).exif).toBeDefined();
    const aus = (await crewFotoUmwandeln(ein))!;
    const m = await sharp(aus).metadata();
    expect(m.format).toBe("webp");
    expect(m.exif).toBeUndefined();
    expect(m.icc).toBeUndefined();
    expect([m.width, m.height]).toEqual([750, 1000]);
    expect(aus.toString("latin1")).not.toContain("Familie Geheim");
  });

  it("kleine Bilder werden nicht vergrößert; PNG geht auch", async () => {
    const m = await sharp((await crewFotoUmwandeln(await bild(400, 300, { png: true })))!).metadata();
    expect([m.format, m.width, m.height]).toEqual(["webp", 400, 300]);
  });

  it("zu groß, leer oder kein Bild → null, ohne zu dekodieren", async () => {
    expect(await crewFotoUmwandeln(Buffer.alloc(FOTO_EINGANG_MAX_BYTES + 1, 1))).toBeNull();
    expect(await crewFotoUmwandeln(Buffer.alloc(0))).toBeNull();
    expect(await crewFotoUmwandeln(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>kaputt"))).toBeNull();
    expect(await crewFotoUmwandeln(Buffer.from("kein bild"))).toBeNull();
  });

  it("base64-Größe ohne Dekodieren", () => {
    for (const n of [0, 1, 2, 3, 100, 1001]) expect(base64Groesse(Buffer.alloc(n, 7).toString("base64"))).toBe(n);
  });

  it("Cache: zuletzt benutzt bleibt, Schlüssel mit Freigabe-Zeitpunkt", () => {
    cacheSchreiben("x:1", Buffer.from("a"));
    expect(cacheLesen("x:1")?.toString()).toBe("a");
    expect(cacheLesen("x:2")).toBeNull();
  });
});

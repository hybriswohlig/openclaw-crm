import { describe, expect, it } from "vitest";
import { googleMapsLink, punkteAusLink, punkteSchluessel } from "./route-link";

describe("googleMapsLink", () => {
  it("Station ist Start und Ziel, Wegpunkte kodiert, auch Sonderzeichen", () => {
    const link = googleMapsLink({
      station: "Sixt, Löwentorstraße 12 & 14, 70376 Stuttgart",
      beladen: "Am Kräherwald 12a, 70193 Stuttgart",
      entladen: "Rue de l'Église 4/1, 67000 Strasbourg #2",
    });
    expect(link).toBe(
      "https://www.google.com/maps/dir/?api=1" +
        "&origin=Sixt%2C%20L%C3%B6wentorstra%C3%9Fe%2012%20%26%2014%2C%2070376%20Stuttgart" +
        "&destination=Sixt%2C%20L%C3%B6wentorstra%C3%9Fe%2012%20%26%2014%2C%2070376%20Stuttgart" +
        "&waypoints=Am%20Kr%C3%A4herwald%2012a%2C%2070193%20Stuttgart%7CRue%20de%20l'%C3%89glise%204%2F1%2C%2067000%20Strasbourg%20%232" +
        "&travelmode=driving"
    );
    const u = new URL(link);
    expect(u.searchParams.get("origin")).toBe("Sixt, Löwentorstraße 12 & 14, 70376 Stuttgart");
    expect(u.searchParams.get("waypoints")).toBe("Am Kräherwald 12a, 70193 Stuttgart|Rue de l'Église 4/1, 67000 Strasbourg #2");
  });

  it("ohne Entladen nur Beladen als Wegpunkt", () => {
    const link = googleMapsLink({ station: "S 1, 70173 Stuttgart", beladen: "B 2, 70173 Stuttgart", entladen: null });
    expect(new URL(link).searchParams.get("waypoints")).toBe("B 2, 70173 Stuttgart");
  });

  it("punkteAusLink liest die Punkte zurück", () => {
    const p = { station: "S 1 | x, 70173 Stuttgart", beladen: "B 2, 70173 Stuttgart", entladen: "E 3, 70173 Stuttgart" };
    // Ein "|" in der Station ist harmlos: nur die Wegpunkte werden getrennt.
    expect(punkteAusLink(googleMapsLink(p))).toEqual(p);
    expect(punkteAusLink(googleMapsLink({ ...p, entladen: null }))).toEqual({ ...p, entladen: null });
    expect(punkteAusLink("kein link")).toBeNull();
  });
});

describe("punkteSchluessel", () => {
  it("gleich bei Groß/Klein und Leerzeichen, verschieden bei anderem Punkt", () => {
    const a = punkteSchluessel({ station: "S 1, Stuttgart", beladen: "B 2,  Stuttgart", entladen: null });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(punkteSchluessel({ station: "s 1, stuttgart", beladen: " B 2, Stuttgart", entladen: null })).toBe(a);
    expect(punkteSchluessel({ station: "S 1, Stuttgart", beladen: "B 2, Stuttgart", entladen: "E 3, Esslingen" })).not.toBe(a);
  });
});

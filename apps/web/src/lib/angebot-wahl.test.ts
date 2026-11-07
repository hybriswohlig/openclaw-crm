import { describe, expect, it } from "vitest";
import type { Uebersteuerung } from "./kalkulation-versionen";
import {
  RENDER_JOB_RESERVIERUNG_MS,
  jobAblage,
  jobReservierbar,
  kvStand,
  verwaisteZeilenUebersteuerungen,
} from "./angebot-wahl";

const ost = "fahrzeug.sprinter@sixt-muc-ost.miete";
const west = "fahrzeug.sprinter@sixt-muc-west.miete";
const sued = "fahrzeug.sprinter@sixt-ber-sued.miete";

function zeile(key: string, wert: Uebersteuerung["wert"], id: string, art: Uebersteuerung["art"] = "zeile"): Uebersteuerung {
  return {
    id,
    art,
    key,
    rechnerwert: 100,
    wert,
    grund: "Test",
    autor: { userId: null, quelle: "mensch" },
    zeit: "2026-11-07T08:00:00.000Z",
    fotoRef: null,
  };
}

describe("jobAblage", () => {
  it("legt ohne Version ab, wenn es kein KV ist oder die Version fehlt", () => {
    expect(jobAblage({ documentType: "invoice", calculationVersionId: "v1" }, "v1")).toBe("ohne_version");
    expect(jobAblage({ documentType: "order_confirmation", calculationVersionId: null }, null)).toBe("ohne_version");
    expect(jobAblage({ documentType: "quotation", calculationVersionId: null }, "v1")).toBe("ohne_version");
    expect(jobAblage({ documentType: "quotation", calculationVersionId: null }, null)).toBe("ohne_version");
  });

  it("legt mit Version ab, wenn die Quotation dieselbe Version trägt, sonst verwerfen", () => {
    expect(jobAblage({ documentType: "quotation", calculationVersionId: "v1" }, "v1")).toBe("mit_version");
    expect(jobAblage({ documentType: "quotation", calculationVersionId: "v1" }, "v2")).toBe("verwerfen");
    expect(jobAblage({ documentType: "quotation", calculationVersionId: "v1" }, null)).toBe("verwerfen");
  });
});

describe("jobReservierbar", () => {
  const jetzt = new Date("2026-11-07T10:00:00.000Z");

  it("erlaubt laeuft ohne Reservierung und eine Reservierung ab zwei Minuten", () => {
    expect(jobReservierbar({ status: "laeuft", claimedAt: null }, jetzt)).toBe(true);
    expect(jobReservierbar({ status: "laeuft", claimedAt: new Date(jetzt.getTime() - 1_000).toISOString() }, jetzt)).toBe(false);
    expect(
      jobReservierbar(
        { status: "laeuft", claimedAt: new Date(jetzt.getTime() - RENDER_JOB_RESERVIERUNG_MS).toISOString() },
        jetzt,
      ),
    ).toBe(true);
  });

  it("lehnt andere Status ab", () => {
    for (const status of ["abgelegt", "verworfen", "fehler"] as const) {
      expect(jobReservierbar({ status, claimedAt: null }, jetzt)).toBe(false);
    }
  });
});

describe("kvStand", () => {
  it("unterscheidet ohne Version, passend und veraltet", () => {
    expect(kvStand(null, null)).toBe("ohne_version");
    expect(kvStand(null, { calculationVersionId: "v1" })).toBe("ohne_version");
    expect(kvStand("v1", { calculationVersionId: "v1" })).toBe("passt");
    expect(kvStand("v1", { calculationVersionId: "v2" })).toBe("veraltet");
    expect(kvStand("v1", { calculationVersionId: null })).toBe("veraltet");
    expect(kvStand("v1", null)).toBe("veraltet");
  });
});

describe("verwaisteZeilenUebersteuerungen", () => {
  it("nennt bei Stationswechsel den Kandidaten derselben Klasse und desselben Teils", () => {
    const aus = verwaisteZeilenUebersteuerungen(
      [zeile(ost, 80, "u1"), zeile(west, 10, "bleibt")],
      [{ key: sued }, { key: west }, {}, { key: "fahrzeug.sprinter@sixt-muc-west.km" }],
    );
    expect(aus).toEqual([{ id: "u1", key: ost, kandidaten: [sued, west] }]);
  });

  it("hat bei Klassenwechsel keinen Kandidaten", () => {
    const aus = verwaisteZeilenUebersteuerungen(
      [zeile(ost, 80, "u2")],
      [{ key: "fahrzeug.kastenwagen@sixt-muc-west.miete" }],
    );
    expect(aus).toEqual([{ id: "u2", key: ost, kandidaten: [] }]);
  });

  it("übergeht eine gelöschte Übersteuerung (wert null)", () => {
    expect(verwaisteZeilenUebersteuerungen([zeile(ost, null, "weg")], [{ key: west }])).toEqual([]);
  });

  it("lässt die letzte Nennung gewinnen, auch wenn sie löscht", () => {
    expect(verwaisteZeilenUebersteuerungen([zeile(ost, 10, "alt"), zeile(ost, 90, "neu")], [])).toEqual([
      { id: "neu", key: ost, kandidaten: [] },
    ]);
    expect(verwaisteZeilenUebersteuerungen([zeile(ost, 10, "alt"), zeile(ost, null, "geloescht")], [])).toEqual([]);
  });

  it("nimmt einen Schlüssel, der kein Fahrzeug ist, ohne Kandidaten", () => {
    expect(
      verwaisteZeilenUebersteuerungen(
        [zeile("material.kartons", 5, "m1"), zeile(ost, 1, "marge", "marge")],
        [{ key: west }],
      ),
    ).toEqual([{ id: "m1", key: "material.kartons", kandidaten: [] }]);
  });
});

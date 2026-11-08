import { describe, expect, it } from "vitest";
import { navZaehlerLesen } from "./use-nav-zaehler";

describe("navZaehlerLesen", () => {
  it("liest { data: { heute, leads } }", () => {
    expect(navZaehlerLesen({ data: { heute: 4, leads: 19 } })).toEqual({ heute: 4, leads: 19, kasse: 0 });
    expect(navZaehlerLesen({ data: { heute: 0, leads: 0 } })).toEqual({ heute: 0, leads: 0, kasse: 0 });
    expect(navZaehlerLesen({ data: { heute: 0, leads: 0, kasse: 3 } })).toEqual({ heute: 0, leads: 0, kasse: 3 });
  });

  it("alles andere ist null (Fehler bleiben still)", () => {
    expect(navZaehlerLesen(null)).toBeNull();
    expect(navZaehlerLesen({ error: { code: "x", message: "y" } })).toBeNull();
    expect(navZaehlerLesen({ data: { heute: "4", leads: 1 } })).toBeNull();
    expect(navZaehlerLesen({ data: { heute: -1, leads: 1 } })).toBeNull();
    expect(navZaehlerLesen({ data: { heute: Number.NaN, leads: 1 } })).toBeNull();
    expect(navZaehlerLesen({ data: { heute: 1 } })).toBeNull();
  });
});

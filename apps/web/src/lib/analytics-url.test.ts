import { describe, expect, it } from "vitest";
import {
  amplitudeOhneAbfrage,
  amplitudeSperre,
  eigenschaftenOhneAbfrage,
  GA4_ADRESSEN_SKRIPT,
  ohneAbfrage,
  plausibleOhneAbfrage,
} from "./analytics-url";

const O = "https://crm.example.de";
const LEAD = "3f2b8c1e-0a4d-4c6e-9b7a-5d1e2f3a4b5c";

describe("ohneAbfrage", () => {
  it("schneidet Abfrage und Anker bei Adressen dieses Ursprungs ab", () => {
    expect(ohneAbfrage(`${O}/home?lead=${LEAD}&firma=abc`, O)).toBe(`${O}/home`);
    expect(ohneAbfrage(`${O}/search?q=M%C3%BCller`, O)).toBe(`${O}/search`);
    expect(ohneAbfrage(`${O}/search?q=Müller`, O)).toBe(`${O}/search`);
    expect(ohneAbfrage(`${O}/inbox#conv=123`, O)).toBe(`${O}/inbox`);
    expect(ohneAbfrage(`${O}/home?lead=1#x`, O)).toBe(`${O}/home`);
    expect(ohneAbfrage(`${O}?lead=1`, O)).toBe(O);
    expect(ohneAbfrage(`${O}#top`, O)).toBe(O);
  });

  it("lässt Adressen ohne Abfrage unverändert (auch dekodierte Umlaute im Pfad)", () => {
    expect(ohneAbfrage(`${O}/home`, O)).toBe(`${O}/home`);
    expect(ohneAbfrage(`${O}/`, O)).toBe(`${O}/`);
    expect(ohneAbfrage(O, O)).toBe(O);
    expect(ohneAbfrage(`${O}/objects/umzüge`, O)).toBe(`${O}/objects/umzüge`);
  });

  it("lässt fremde Adressen und andere Werte stehen", () => {
    expect(ohneAbfrage("https://www.google.com/search?q=umzug", O)).toBe("https://www.google.com/search?q=umzug");
    // anderer Port bzw. Host mit gleichem Anfang ist ein anderer Ursprung
    expect(ohneAbfrage("https://crm.example.de.evil.io/x?y=1", O)).toBe("https://crm.example.de.evil.io/x?y=1");
    expect(ohneAbfrage("http://localhost:30012/x?y=1", "http://localhost:3001")).toBe("http://localhost:30012/x?y=1");
    expect(ohneAbfrage("/home?lead=1", O)).toBe("/home?lead=1");
    expect(ohneAbfrage("Lagekarte?", O)).toBe("Lagekarte?");
    expect(ohneAbfrage("", O)).toBe("");
    expect(ohneAbfrage(`${O}/home?lead=1`, "")).toBe(`${O}/home?lead=1`);
  });
});

describe("eigenschaftenOhneAbfrage", () => {
  it("kürzt Zeichenketten, auch verschachtelt, und lässt das Original unverändert", () => {
    const vorher = {
      "[Amplitude] Page Location": `${O}/home?lead=${LEAD}`,
      "[Amplitude] Page Path": "/home",
      "[Amplitude] Page Counter": 3,
      liste: [`${O}/a?b=1`, 2, null],
      $set: { referrer: `${O}/search?q=Meier`, utm_source: "newsletter" },
      $setOnce: { initial_referrer: "https://www.google.com/?q=x" },
      leer: null,
      ja: true,
    };
    const kopie = structuredClone(vorher);
    expect(eigenschaftenOhneAbfrage(vorher, O)).toEqual({
      "[Amplitude] Page Location": `${O}/home`,
      "[Amplitude] Page Path": "/home",
      "[Amplitude] Page Counter": 3,
      liste: [`${O}/a`, 2, null],
      $set: { referrer: `${O}/search`, utm_source: "newsletter" },
      $setOnce: { initial_referrer: "https://www.google.com/?q=x" },
      leer: null,
      ja: true,
    });
    expect(vorher).toEqual(kopie);
  });
});

describe("amplitudeOhneAbfrage", () => {
  it("bereinigt Seitenansicht, vorherige Seite, Formularziel und Nutzereigenschaften", async () => {
    const plugin = amplitudeOhneAbfrage(() => O);
    expect(plugin.type).toBe("enrichment");
    const event = await plugin.execute!({
      event_type: "[Amplitude] Page Viewed",
      event_properties: {
        "[Amplitude] Page Domain": "crm.example.de",
        "[Amplitude] Page Location": `${O}/home?lead=${LEAD}&firma=f1`,
        "[Amplitude] Page Path": "/home",
        "[Amplitude] Page Title": "Heute | Umzug-Suite",
        "[Amplitude] Page URL": `${O}/home`,
        "[Amplitude] Previous Page Location": `${O}/search?q=Meier`,
        "[Amplitude] Previous Page Type": "internal",
        "[Amplitude] Form Destination": `${O}/home?lead=${LEAD}`,
        referrer: `${O}/search?q=Meier`,
        referring_domain: "crm.example.de",
      },
      user_properties: { $set: { referrer: `${O}/inbox?conv=7` } },
    });
    expect(event?.event_properties).toEqual({
      "[Amplitude] Page Domain": "crm.example.de",
      "[Amplitude] Page Location": `${O}/home`,
      "[Amplitude] Page Path": "/home",
      "[Amplitude] Page Title": "Heute | Umzug-Suite",
      "[Amplitude] Page URL": `${O}/home`,
      "[Amplitude] Previous Page Location": `${O}/search`,
      "[Amplitude] Previous Page Type": "internal",
      "[Amplitude] Form Destination": `${O}/home`,
      referrer: `${O}/search`,
      referring_domain: "crm.example.de",
    });
    expect(event?.user_properties).toEqual({ $set: { referrer: `${O}/inbox` } });
  });

  it("Ereignis ohne Eigenschaften bleibt wie es ist", async () => {
    const event = await amplitudeOhneAbfrage(() => O).execute!({ event_type: "session_start" });
    expect(event).toEqual({ event_type: "session_start" });
  });
});

describe("amplitudeSperre", () => {
  it("hält Ereignisse bis zur Freigabe an", async () => {
    const { plugin, freigeben } = amplitudeSperre();
    expect(plugin.type).toBe("before");
    let durch = false;
    const laeuft = plugin.execute!({ event_type: "x" }).then((e) => {
      durch = true;
      return e;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(durch).toBe(false);
    freigeben();
    expect(await laeuft).toEqual({ event_type: "x" });
    // nach der Freigabe läuft alles sofort durch
    expect(await plugin.execute!({ event_type: "y" })).toEqual({ event_type: "y" });
  });
});

describe("plausibleOhneAbfrage", () => {
  it("kürzt Seitenadresse, eigenen Referrer und Adress-Eigenschaften", () => {
    const nutzlast = {
      n: "pageview",
      v: 36,
      u: `${O}/search?q=Meier#treffer`,
      d: "crm.example.de",
      r: `${O}/home?lead=${LEAD}`,
      p: { url: `${O}/inbox?conv=7`, quelle: "liste" },
    };
    expect(plausibleOhneAbfrage(nutzlast, O)).toEqual({
      n: "pageview",
      v: 36,
      u: `${O}/search`,
      d: "crm.example.de",
      r: `${O}/home`,
      p: { url: `${O}/inbox`, quelle: "liste" },
    });
    expect(nutzlast.u).toBe(`${O}/search?q=Meier#treffer`);
  });

  it("fremder Referrer und fehlende Felder bleiben", () => {
    expect(plausibleOhneAbfrage({ n: "pageview", u: `${O}/home`, r: null }, O)).toEqual({ n: "pageview", u: `${O}/home`, r: null });
    expect(plausibleOhneAbfrage({ n: "x", u: `${O}/a`, r: "https://www.google.com/?q=1" }, O).r).toBe("https://www.google.com/?q=1");
  });
});

describe("GA4_ADRESSEN_SKRIPT", () => {
  function fuehreAus(href: string, referrer: string) {
    const url = new URL(href);
    const aufrufe: unknown[][] = [];
    const gtag = (...args: unknown[]) => aufrufe.push(args);
    new Function("gtag", "location", "document", GA4_ADRESSEN_SKRIPT)(gtag, { origin: url.origin, pathname: url.pathname }, { referrer });
    return aufrufe;
  }

  it("setzt page_location ohne Abfrage und kürzt den eigenen Referrer", () => {
    expect(fuehreAus(`${O}/home?lead=${LEAD}&firma=f1#x`, `${O}/search?q=Meier`)).toEqual([
      ["set", { page_location: `${O}/home`, page_referrer: `${O}/search` }],
    ]);
  });

  it("fremder Referrer bleibt, ohne Referrer kein page_referrer", () => {
    expect(fuehreAus(`${O}/search?q=x`, "https://www.google.com/?q=umzug")).toEqual([
      ["set", { page_location: `${O}/search`, page_referrer: "https://www.google.com/?q=umzug" }],
    ]);
    expect(fuehreAus(`${O}/home`, "")).toEqual([["set", { page_location: `${O}/home` }]]);
    expect(fuehreAus(`${O}/home`, "https://crm.example.de.evil.io/a?b=1")).toEqual([
      ["set", { page_location: `${O}/home`, page_referrer: "https://crm.example.de.evil.io/a?b=1" }],
    ]);
  });
});

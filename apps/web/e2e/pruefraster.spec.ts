import fs from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import {
  DARSTELLUNG_COOKIE,
  PRUEFRASTER_BREITEN,
  PRUEFRASTER_SEITEN,
  PRUEFRASTER_THEMES,
  pruefFaelle,
  type PruefFall,
} from "../src/lib/dunkel-abschaltung";
import {
  ausgabeOrdner,
  datenbankUrlPruefen,
  kennungenLaden,
  portalTokenLaden,
  pruefSkript,
  type HellFund,
} from "./pruefraster-hilfen";

const LOGIN_EMAIL = "herr.testmann@example.com";
const LOGIN_PASSWORT = "Testdaten-Lokal-1";
const PORTAL_HELL = "rgb(246, 247, 249)";
const REDUCE_BREITE = 1440;

type Theme = (typeof PRUEFRASTER_THEMES)[number];

interface Befund {
  datei: string;
  pfad: string;
  breite: number;
  theme: Theme;
  /** true, wenn die Seite seitlich über das Fenster hinausragt. */
  horizontalScroll: boolean;
  lgTheme: string | null;
  hellFunde: HellFund[];
  uebersprungen?: string;
  portalHintergrund?: string;
}

function aktiveThemes(): Theme[] {
  const roh = process.env.PRUEFRASTER_THEMES ?? "hell";
  const liste: Theme[] = [];
  const gesehen = new Set<string>();
  for (const teil of roh.split(",")) {
    const theme = teil.trim();
    if ((theme === "hell" || theme === "dunkel") && !gesehen.has(theme)) {
      gesehen.add(theme);
      liste.push(theme);
    }
  }
  return liste;
}

const themes = aktiveThemes();

let kennungen: { deal: string; person: string | null } = { deal: "", person: null };
let portalToken: string | null = null;
let ausgabe = "";
let faelle: PruefFall[] = [];
const befunde: Befund[] = [];

function hoehe(breite: number): number {
  return breite === 390 ? 844 : 900;
}

function ursprung(baseURL: string): string {
  return new URL(baseURL).origin;
}

function basisUrl(testInfo: TestInfo): string {
  const url = testInfo.project.use.baseURL;
  if (!url) throw new Error("baseURL fehlt. PRUEFRASTER_BASE_URL oder den Standard der Konfiguration setzen.");
  return url;
}

async function anmelden(context: BrowserContext, baseURL: string): Promise<void> {
  const antwort = await context.request.post("/api/auth/sign-in/email", {
    headers: {
      Origin: ursprung(baseURL),
      Referer: `${ursprung(baseURL)}/`,
    },
    data: {
      email: LOGIN_EMAIL,
      password: LOGIN_PASSWORT,
      rememberMe: true,
    },
  });
  if (!antwort.ok()) {
    const text = await antwort.text();
    throw new Error(`Anmeldung fehlgeschlagen (${antwort.status()}): ${text.slice(0, 400)}`);
  }
}

async function netzAbwarten(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch((err: unknown) => {
    if (err instanceof Error && err.name === "TimeoutError") return;
    throw err;
  });
}

async function seitePruefen(opts: {
  browser: Browser;
  testInfo: TestInfo;
  pfad: string;
  datei: string;
  breite: number;
  theme: Theme;
  reduce?: boolean;
}): Promise<void> {
  const baseURL = basisUrl(opts.testInfo);
  const context = await opts.browser.newContext({
    viewport: { width: opts.breite, height: hoehe(opts.breite) },
    baseURL,
  });
  try {
    await context.addCookies([
      {
        name: DARSTELLUNG_COOKIE,
        value: opts.theme,
        url: ursprung(baseURL),
      },
    ]);
    if (opts.reduce) {
      await context.addInitScript(() => {
        document.documentElement.setAttribute("data-lg-reduce-transparency", "1");
      });
    }
    await anmelden(context, baseURL);
    const page = await context.newPage();
    await page.goto(opts.pfad, { waitUntil: "domcontentloaded" });
    await netzAbwarten(page);
    await page.screenshot({ path: path.join(ausgabe, opts.datei), fullPage: true });

    const keinUeberlauf = await page.evaluate(pruefSkript.horizontalScroll);
    const lgTheme = await page.evaluate(pruefSkript.lgTheme);
    const hellFunde = opts.theme === "dunkel" ? await page.evaluate(pruefSkript.helleFlaechen) : [];
    if (opts.theme === "dunkel") {
      await opts.testInfo.attach("helle-flaechen", {
        body: JSON.stringify(hellFunde, null, 2),
        contentType: "application/json",
      });
      if (lgTheme !== "dark") {
        await opts.testInfo.attach("lg-theme", {
          body: `erwartet dark, gelesen ${lgTheme ?? "null"}`,
          contentType: "text/plain",
        });
      }
    }

    befunde.push({
      datei: opts.datei,
      pfad: opts.pfad,
      breite: opts.breite,
      theme: opts.theme,
      horizontalScroll: !keinUeberlauf,
      lgTheme,
      hellFunde,
    });

    expect.soft(keinUeberlauf, `${opts.datei}: Seite breiter als das Fenster`).toBe(true);
    if (opts.theme === "hell") {
      expect(lgTheme, `${opts.datei}: data-lg-theme`).toBe("light");
    }
  } finally {
    await context.close();
  }
}

function fallSuchen(seite: string, breite: number, theme: Theme): PruefFall {
  const person = kennungen.person ?? "OHNE_PERSON";
  const pfad = seite.replace(":deal", kennungen.deal).replace(":person", person);
  const fall = faelle.find((eintrag) => eintrag.pfad === pfad && eintrag.breite === breite && eintrag.theme === theme);
  if (!fall) throw new Error(`Prüffall fehlt: ${seite} ${breite} ${theme}`);
  return fall;
}

function ueberspringen(fall: PruefFall, grund: string): void {
  befunde.push({
    datei: fall.datei,
    pfad: fall.pfad,
    breite: fall.breite,
    theme: fall.theme,
    horizontalScroll: false,
    lgTheme: null,
    hellFunde: [],
    uebersprungen: grund,
  });
  test.skip(true, grund);
}

test.describe("Prüfraster", () => {
  test.beforeAll(async () => {
    const url = process.env.PRUEFRASTER_DATABASE_URL?.trim();
    if (!url) {
      throw new Error("PRUEFRASTER_DATABASE_URL fehlt. Nur eine lokale Wegwerf-Datenbank ist erlaubt.");
    }
    datenbankUrlPruefen(url);
    kennungen = await kennungenLaden(url);
    portalToken = await portalTokenLaden(url, kennungen.deal);
    ausgabe = ausgabeOrdner();
    const erlaubt = new Set<string>(themes);
    faelle = pruefFaelle({ deal: kennungen.deal, person: kennungen.person ?? "OHNE_PERSON" }).filter((fall) =>
      erlaubt.has(fall.theme)
    );
  });

  test.afterAll(async () => {
    if (!ausgabe) return;
    await fs.promises.writeFile(path.join(ausgabe, "befunde.json"), `${JSON.stringify(befunde, null, 2)}\n`);
  });

  for (const seite of PRUEFRASTER_SEITEN) {
    for (const breite of PRUEFRASTER_BREITEN) {
      for (const theme of themes) {
        test(`${seite} ${breite} ${theme}`, async ({ browser }, testInfo) => {
          const fall = fallSuchen(seite, breite, theme);
          if (fall.pfad.includes("OHNE_PERSON")) {
            ueberspringen(fall, "keine Person");
            return;
          }
          await seitePruefen({
            browser,
            testInfo,
            pfad: fall.pfad,
            datei: fall.datei,
            breite: fall.breite,
            theme: fall.theme,
          });
        });
      }
    }
  }

  if (themes.includes("dunkel")) {
    test("akte reduce dunkel", async ({ browser }, testInfo) => {
      await seitePruefen({
        browser,
        testInfo,
        pfad: `/app/leads/${kennungen.deal}`,
        datei: "akte-reduce-dunkel.png",
        breite: REDUCE_BREITE,
        theme: "dunkel",
        reduce: true,
      });
    });

    test("heute reduce dunkel", async ({ browser }, testInfo) => {
      await seitePruefen({
        browser,
        testInfo,
        pfad: "/app/heute",
        datei: "heute-reduce-dunkel.png",
        breite: REDUCE_BREITE,
        theme: "dunkel",
        reduce: true,
      });
    });
  }

  test("portal dunkel erzwungen", async ({ browser }, testInfo) => {
    const baseURL = basisUrl(testInfo);
    if (!portalToken) {
      befunde.push({
        datei: "portal-dunkel-erzwungen.png",
        pfad: "/s/",
        breite: REDUCE_BREITE,
        theme: "dunkel",
        horizontalScroll: false,
        lgTheme: null,
        hellFunde: [],
        uebersprungen: "kein Portal-Token",
      });
      test.skip(true, "kein Portal-Token");
      return;
    }

    const pfad = `/s/${portalToken}`;
    const context = await browser.newContext({
      viewport: { width: REDUCE_BREITE, height: hoehe(REDUCE_BREITE) },
      baseURL,
    });
    try {
      await context.addInitScript(() => {
        localStorage.setItem("theme", "dark");
        document.documentElement.classList.add("dark");
      });
      const page = await context.newPage();
      await page.goto(pfad, { waitUntil: "domcontentloaded" });
      await netzAbwarten(page);
      await page.screenshot({ path: path.join(ausgabe, "portal-dunkel-erzwungen.png"), fullPage: true });

      const hintergrund = await page.evaluate(() => {
        const el = document.querySelector(".kottke-portal") ?? document.body;
        return getComputedStyle(el).backgroundColor;
      });
      const keinUeberlauf = await page.evaluate(pruefSkript.horizontalScroll);
      const lgTheme = await page.evaluate(pruefSkript.lgTheme);
      const passt = hintergrund.replace(/\s+/g, "").toLowerCase() === PORTAL_HELL.replace(/\s+/g, "");
      const hellFunde: HellFund[] = passt
        ? []
        : [{ beschreibung: ".kottke-portal Hintergrund", farbe: hintergrund }];
      await testInfo.attach("portal-hintergrund", {
        body: JSON.stringify({ hintergrund, erwartet: PORTAL_HELL, passt }, null, 2),
        contentType: "application/json",
      });
      befunde.push({
        datei: "portal-dunkel-erzwungen.png",
        pfad,
        breite: REDUCE_BREITE,
        theme: "dunkel",
        horizontalScroll: !keinUeberlauf,
        lgTheme,
        hellFunde,
        portalHintergrund: hintergrund,
      });
    } finally {
      await context.close();
    }
  });
});

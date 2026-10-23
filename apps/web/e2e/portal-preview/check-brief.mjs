import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

// Kottke-Look: alle Stufen hell und dunkel, ohne Überlauf, mit Logo und lesbarem Kontrast;
// Brief mit Preis im ersten Blick; Firma ohne Logo und Ansprechpartner ohne kaputte Bilder.
const out = process.env.PORTAL_SCREENSHOT_DIR || "/tmp/portal-redesign";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];

async function oeffnen(query, width) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  page.on("pageerror", (e) => errors.push(`${query}@${width}: ${e.message}`));
  await page.route("**/*", (r) => (new URL(r.request().url()).hostname === "127.0.0.1" ? r.continue() : r.abort()));
  await page.goto(`http://127.0.0.1:4178/?${query}`, { waitUntil: "networkidle" });
  return page;
}

/** Kontrast über echte Pixel: Farben aus color-mix() oder oklab() rechnet der Browser selbst um. */
async function kontraste(page, selektoren) {
  return page.evaluate((sels) => {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const g = c.getContext("2d", { willReadFrequently: true });
    const rgb = (farbe) => {
      g.clearRect(0, 0, 1, 1);
      g.fillStyle = farbe;
      g.fillRect(0, 0, 1, 1);
      return [...g.getImageData(0, 0, 1, 1).data];
    };
    const lum = ([r, gr, b]) => {
      const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(gr) + 0.0722 * f(b);
    };
    const grund = (el) => {
      for (let e = el; e; e = e.parentElement) {
        const px = rgb(getComputedStyle(e).backgroundColor);
        if (px[3] > 250) return px;
      }
      return [255, 255, 255, 255];
    };
    return sels.flatMap((sel) =>
      [...document.querySelectorAll(sel)]
        .filter((el) => el.offsetParent !== null && el.textContent.trim())
        .slice(0, 3)
        .map((el) => {
          const a = lum(rgb(getComputedStyle(el).color));
          const b = lum(grund(el));
          return { sel, text: el.textContent.trim().slice(0, 30), kontrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
        }),
    );
  }, selektoren);
}

const ANSICHTEN = [
  "festangebot",
  "festangebot&angenommen&unterschrieben",
  "festangebot&otherbrand&angenommen&unterschrieben",
  "festangebot&termin",
  "stage=1",
  "stage=2",
  "stage=3&live",
  "stage=4",
];
for (const ansicht of ANSICHTEN) {
  for (const width of [390, 1440]) {
    for (const dunkel of [false, true]) {
      const query = dunkel ? `${ansicht}&dark` : ansicht;
      const page = await oeffnen(query, width);
      const name = `${query.replace(/[&=]/g, "-")}-${width}`;
      await page.screenshot({ path: `${out}/brief-${name}.png`, fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Überlauf ${name}`);
      if (!ansicht.includes("otherbrand")) {
        const logo = await page.locator(".portal-briefkopf .portal-logo img").evaluate((img) => img.complete && img.naturalWidth > 0);
        assert.ok(logo, `Logo geladen ${name}`);
      }
      const KLEIN = [".portal-fest-kicker", ".portal-strecke dt", ".portal-step-status", ".portal-stempel strong", ".portal-annahme-vertrag", "section button"];
      for (const k of await kontraste(page, ["h1", "h2", ".portal-price", ".portal-brief-text", ".portal-strecke dd", "p", ...KLEIN])) {
        assert.ok(k.kontrast >= 4.5, `Kontrast ${k.kontrast.toFixed(2)} < 4.5 bei ${k.sel} „${k.text}“ (${name})`);
      }
      if (ansicht.startsWith("festangebot") && width === 390) {
        const top = await page.locator(".portal-brief .portal-fest-price").evaluate((el) => el.getBoundingClientRect().top);
        assert.ok(top <= 520, `Preis bei ${top}px (${name})`);
      }
      await page.close();
    }
  }
  console.log(`PASS ${ansicht}: hell und dunkel, 390 und 1440`);
}

const lang = await oeffnen("festangebot&langeadresse", 390);
assert.equal(await lang.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "lange Adresse ohne Überlauf");
await lang.close();
console.log("PASS lange Adresse");

const fremd = await oeffnen("festangebot&otherbrand&ohnename", 390);
assert.equal(await fremd.locator("img:not([src]), img[src='']").count(), 0, "kein Bild ohne Quelle");
assert.equal(await fremd.locator(".portal-brief-foto, .portal-brief-unterschrift").count(), 0, "ohne Ansprechpartner kein Foto und keine Unterschrift");
await fremd.getByText("Ihr Team von Ceylan Umzüge").waitFor();
await fremd.getByRole("heading", { name: "Guten Tag,", exact: true }).waitFor();
assert.equal(await fremd.locator(".portal-briefkopf .portal-logo img").count(), 0, "ohne Logo der Firmenname als Text");
await fremd.close();
console.log("PASS Firma ohne Logo und Ansprechpartner");

await browser.close();
assert.deepEqual(errors, [], `Seitenfehler: ${errors.join(" | ")}`);
console.log("Brief-Probe ok");

// Plan 5b: Sichtprüfung Paket × Tag, nur Tage, nur Pakete, Stunden, angenommen.
// Voraussetzung: node apps/web/e2e/portal-preview/serve.mjs läuft.
// Screenshots nach PORTAL_SCREENSHOT_DIR (Standard /tmp/portal-5b), Dateien W-<fall>-<breite>.png.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const out = process.env.PORTAL_SCREENSHOT_DIR || "/tmp/portal-5b";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route("**/*", (route) => {
  const url = new URL(route.request().url());
  if (url.hostname !== "127.0.0.1") return route.abort();
  return route.continue();
});

const text = () => page.evaluate(() => document.body.innerText);
const ohneGedankenstrich = async (name) => assert.doesNotMatch(await text(), /[—–]/, `${name}: Gedankenstrich`);

const faelle = [
  ["paketetage", "paketetage", async (t) => {
    assert.match(t, /1\.640\s€/);
    assert.match(t, /Festpreis am Sa 28\.11\./);
    assert.match(t, /Preis an diesem Tag: Sa 28\.11\./);
  }],
  ["paketetage-offen", "paketetage&offen", async (t) => {
    assert.match(t, /Festpreis am Fr 27\.11\./);
    assert.match(t, /Preis am empfohlenen Termin Fr 27\.11\./);
    assert.match(t, /Der Preis hängt vom Tag ab/);
  }],
  ["nurtage", "nurtage", async (t) => {
    assert.match(t, /1\.640\s€/);
    assert.match(t, /Preis an diesem Tag: Sa 28\.11\./);
  }],
  ["nurpakete", "nurpakete", async (t) => {
    assert.match(t, /1\.490\s€/);
    assert.doesNotMatch(t, /Preis an diesem Tag/);
  }],
  ["stunden", "stunden", async (t) => {
    assert.match(t, /715\s€/);
    assert.match(t, /mindestens 3 Stunden \(390\s€\)/);
  }],
  ["stundenalt", "stundenalt", async (t) => {
    assert.match(t, /Stundensatz/);
    assert.match(t, /95\s€/);
    assert.match(t, /je Stunde/);
  }],
  ["angenommen", "paketetage&angenommen", async (t) => {
    assert.match(t, /angenommen/i);
    assert.match(t, /Komfort am Sa 28\.11\./);
  }],
];

try {
  for (const [name, query, pruefen] of faelle) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`http://127.0.0.1:4178/?${query}`, { waitUntil: "networkidle" });
      await page.locator(".portal-header").waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} läuft bei ${width}px über`);
      await pruefen(await text());
      await ohneGedankenstrich(name);
      await page.screenshot({ path: `${out}/W-${name}-${width}.png`, fullPage: true });
      console.log(`PASS ${name} ${width}px`);
    }
  }

  // Tageswechsel: Montag wählen, Preis folgt (Preiskarte, Paketkarten, Termin).
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("http://127.0.0.1:4178/?paketetage", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Ändern" }).click();
  await page.locator("article", { hasText: "30. November" }).getByRole("button", { name: /vormittags/ }).click();
  await page.getByRole("button", { name: "Diesen Termin wählen" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("Preis an diesem Tag: Mo 30.11."));
  assert.match(await text(), /1\.390\s€/);
  console.log("PASS Tageswechsel");

  // Paketwechsel am gewählten Tag: Premium am Montag.
  await page.getByRole("button", { name: /Premium/ }).click();
  await page.waitForFunction(() => document.querySelector(".portal-offer-price-card")?.textContent?.includes("1.770"));
  console.log("PASS Paketwechsel");

  // Annahmedialog zeigt denselben Preis und den Tag.
  await page.getByRole("button", { name: /Angebot verbindlich annehmen/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  const d = await dialog.innerText();
  assert.match(d, /1\.770\s€/);
  assert.match(d, /Premium am Mo 30\.11\./);
  assert.match(d, /Preis an diesem Tag: Mo 30\.11\./);
  await page.screenshot({ path: `${out}/W-dialog-1440.png` });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({ path: `${out}/W-dialog-390.png` });
  console.log("PASS Dialog");

  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}

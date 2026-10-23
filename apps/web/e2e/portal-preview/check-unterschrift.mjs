import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
// Unterschrift im Portal: Abschluss-Dialog (gezeichnet), Nebenaktion in Stufe 2 (getippt), ohne Einstellung kein Panel.
const out = process.env.PORTAL_SCREENSHOT_DIR || "/tmp/portal-redesign";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
async function seite(width) {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, hasTouch: width < 500 });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (/\/documents\/[^/]+$/.test(url.pathname)) return route.fulfill({ contentType: "application/pdf", body: "%PDF-1.4\n%%EOF" });
    return route.continue();
  });
  return page;
}
async function zeichnen(page) {
  await page.waitForTimeout(500); // Bottom-Sheet gleitet auf dem Handy noch herein
  const box = await page.locator(".portal-signature-pad").first().boundingBox();
  await page.mouse.move(box.x + 30, box.y + 120);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + 30 + i * 12, box.y + 120 - Math.sin(i / 2) * 50, { steps: 2 });
  await page.mouse.up();
}
for (const width of [1440, 390]) {
  // A: Annahme, danach Unterschrift im Abschluss-Dialog (gezeichnet)
  const a = await seite(width);
  await a.goto("http://127.0.0.1:4178/?unterschrift", { waitUntil: "networkidle" });
  await a.locator(width < 500 ? "button:has-text('Angebot annehmen')" : "button:has-text('Angebot verbindlich annehmen')").first().click();
  await a.locator("#acc-offer").check();
  if (await a.locator("#acc-haftung").count()) await a.locator("#acc-haftung").check();
  await a.locator("button:has-text('Zahlungspflichtig beauftragen')").click();
  await a.locator("text=Vertrag unterschreiben (freiwillig)").waitFor();
  await a.screenshot({ path: `${out}/a-${width}-formular.png` });
  assert.equal(await a.locator("button:has-text('Unterschrift bestätigen')").isDisabled(), true, "Knopf vor dem Zeichnen gesperrt");
  await zeichnen(a);
  await a.locator("button:has-text('Unterschrift bestätigen'):not([disabled])").waitFor({ timeout: 3000 }); // Knopf nach dem Zeichnen frei
  await a.screenshot({ path: `${out}/a-${width}-gezeichnet.png` });
  await a.locator("button:has-text('Unterschrift bestätigen')").click();
  await a.locator("text=Vielen Dank, Ihr Vertrag ist unterschrieben.").waitFor();
  await a.screenshot({ path: `${out}/a-${width}-fertig.png` });
  assert.equal(await a.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `A overflow ${width}`);
  const posts = await a.evaluate(() => window.__portalPosts);
  assert.ok(posts.some((u) => u.endsWith("/unterschrift")), "POST /unterschrift gesendet");
  await a.close();

  // B: Stufe 2, Nebenaktion im Panel (getippt), danach unter Dokumente
  const b = await seite(width);
  await b.goto("http://127.0.0.1:4178/?stage=2&unterschrift", { waitUntil: "networkidle" });
  // Nebenaktion: das Panel steht hinter dem Auftragsinhalt (Anzahlung, Rechnung, Dokumente haben Vorrang).
  const nachInhalt = await b.evaluate(() => {
    const panel = [...document.querySelectorAll("section")].find((el) => el.textContent?.includes("Ihr Auftrag ist bereits verbindlich erteilt"));
    const inhalt = document.getElementById("portal-content");
    return !!panel && !!inhalt && !inhalt.contains(panel) && !!(inhalt.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  assert.ok(nachInhalt, `Panel steht nach dem Auftragsinhalt (${width})`);
  await b.locator("section:has-text('Vertrag unterschreiben') button:has-text('Vertrag unterschreiben')").click();
  await b.getByRole("button", { name: "Lieber tippen", exact: true }).click();
  await b.screenshot({ path: `${out}/b-${width}-getippt.png`, fullPage: false });
  await b.locator("button:has-text('Unterschrift bestätigen')").click();
  await b.getByText("Unterschriebener Vertrag als PDF herunterladen", { exact: true }).waitFor();
  assert.equal(await b.locator("section:has-text('Ihr Auftrag ist bereits verbindlich erteilt')").count(), 0, "Panel nach Unterschrift weg");
  await b.screenshot({ path: `${out}/b-${width}-dokumente.png`, fullPage: true });
  assert.equal(await b.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `B overflow ${width}`);
  await b.close();

  // C: ohne Einschalten kein Panel
  const c = await seite(width);
  await c.goto("http://127.0.0.1:4178/?stage=2", { waitUntil: "networkidle" });
  assert.equal(await c.locator("text=Vertrag unterschreiben").count(), 0, "ohne signature kein Panel");
  await c.close();
}
await browser.close();
assert.deepEqual(errors, [], `Seitenfehler: ${errors.join(" | ")}`);
console.log("Unterschrift-Probe ok");

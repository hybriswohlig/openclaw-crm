import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const out = process.env.PORTAL_SCREENSHOT_DIR || "/tmp/portal-redesign";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const pdfPage = await browser.newPage();
await pdfPage.setContent('<html lang="de"><body style="font-family:Arial;color:#09205e;padding:40px"><h2>Kottke-Umzüge</h2><h1>Auftragsbestätigung</h1><p>Auftragsnummer: VORSCHAU-2026</p><p>Lokales Testdokument für die Prüfung der PDF-Vorschau.</p></body></html>');
const testPdf = await pdfPage.pdf({ format: "A4" });
await pdfPage.close();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await page.route("**/*", route => {
  const url = new URL(route.request().url());
  if (url.hostname !== "127.0.0.1") return route.abort();
  if (url.pathname.endsWith(".pdf") || /\/documents\/[^/]+$/.test(url.pathname)) return route.fulfill({ contentType: "application/pdf", body: testPdf });
  return route.continue();
});
try {
  for (const [name, query] of [["offers", ""], ["single", "single"], ["confirmed", "stage=2"], ["move-default", "stage=3"], ["move-live", "stage=3&live"], ["done", "stage=4"], ["done-payments", "stage=4&payments"], ["otherbrand", "otherbrand"], ["dark", "dark"]]) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`http://127.0.0.1:4178/?${query}`, { waitUntil: "networkidle" });
      await page.locator(".portal-header").waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} overflows at ${width}px`);
      assert.equal(await page.locator(".portal-progress [aria-current=step]").count(), 1);
      if (name === "single") assert.equal(await page.locator(".portal-package-card").count(), 1);
      if (name === "move-default") assert.equal(await page.locator(".portal-live-timeline").count(), 0);
      if (name === "move-live") assert.equal(await page.locator(".portal-live-timeline").count(), 1);
      if (name === "done") assert.equal(await page.getByRole("button", { name: "Ich habe bezahlt", exact: true }).count(), 0);
      if (name === "otherbrand") assert.equal(await page.locator(".portal-success-art").count(), 0);
      await page.screenshot({ path: `${out}/${name}-${width}.png`, fullPage: true });
      console.log(`PASS ${name} ${width}px`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("http://127.0.0.1:4178/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Basic Nur Transport/ }).click();
  await page.waitForFunction(() => document.querySelector(".portal-offer-price-card")?.textContent?.includes("1.360,49"));
  assert.match(await page.locator(".portal-quotation").innerText(), /1\.360,49/);
  await page.getByRole("button", { name: "Angebot verbindlich annehmen", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.screenshot({ path: `${out}/acceptance-dialog.png` });
  const submit = page.getByRole("dialog").getByRole("button", { name: /verbindlich/i });
  assert.equal(await submit.isDisabled(), true);
  await page.locator("#acc-offer").check();
  await page.locator("#acc-binding").check();
  assert.equal(await submit.isEnabled(), true);
  await submit.click();
  await page.getByRole("heading", { name: "Vielen Dank für Ihr Vertrauen!" }).waitFor();
  console.log("PASS selection, exact price, dialog consent gates and acceptance stage transition");
  await page.goto("http://127.0.0.1:4178/?single", { waitUntil: "networkidle" });
  const quotationPdf = await page.pdf({ path: `${out}/quotation-print.pdf`, format: "A4", printBackground: true });
  assert.equal((quotationPdf.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length, 1, "Quotation print should not include blank portal-layout pages");
  console.log("PASS quotation PDF print without blank pages");
  await page.goto("http://127.0.0.1:4178/?expired", { waitUntil: "networkidle" });
  assert.equal(await page.getByRole("button", { name: "Angebot verbindlich annehmen", exact: true }).count(), 0);
  await page.goto("http://127.0.0.1:4178/?empty", { waitUntil: "networkidle" });
  assert.match(await page.locator("#portal-content").innerText(), /wird gerade erstellt/);
  console.log("PASS expiry and missing offer");
  await page.goto("http://127.0.0.1:4178/?stage=4&payments", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Ich habe bezahlt", exact: true }).click();
  await page.getByText(/Wir prüfen den Zahlungseingang/).waitFor();
  assert.equal(await page.getByText("Bereits bezahlt", { exact: true }).count(), 0);
  console.log("PASS payment report remains unverified");
  await page.goto("http://127.0.0.1:4178/?stage=2", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Per E-Mail senden", exact: true }).click();
  await page.getByRole("button", { name: "E-Mail versendet", exact: true }).waitFor();
  console.log("PASS document email UI with mocked transport");
  assert.deepEqual(errors, [], "Browser runtime errors");
  console.log(`Screenshots: ${out}`);
} catch (error) { console.error("Page errors:", errors); console.error((await page.locator("body").innerText()).slice(0, 5000)); await page.screenshot({ path: `${out}/failure.png` }); throw error; } finally { await browser.close(); }

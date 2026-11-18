// Sichtprüfung des KV-Editors mit Testdaten (Plan Aufgabe 6a): startet die Vorschau, prüft
// 1440 und 390 px hell und dunkel, die Zustände und die Hauptwege (Bearbeiten, Chat,
// Pushen, Zusammenführen). Screenshots nach KVE_SCREENSHOT_DIR (Standard /tmp/kv-editor-preview).
// Browser: Playwright-Chromium, sonst das installierte Chrome (channel "chrome").
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hier = path.dirname(fileURLToPath(import.meta.url));
const out = process.env.KVE_SCREENSHOT_DIR || "/tmp/kv-editor-preview";
await fs.mkdir(out, { recursive: true });

const server = spawn(process.execPath, [path.join(hier, "serve.mjs")], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((ok, nein) => {
  const t = setTimeout(() => nein(new Error("Vorschau startet nicht")), 60_000);
  server.stdout.on("data", (d) => {
    if (String(d).includes("4179")) {
      clearTimeout(t);
      ok();
    }
  });
  server.on("exit", (c) => nein(new Error(`Vorschau beendet (${c})`)));
});

let browser;
try {
  browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ headless: true, channel: "chrome" }));
} catch (e) {
  server.kill();
  throw e;
}
const fehler = [];
const page = await browser.newPage();
page.on("pageerror", (e) => fehler.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !/favicon|vorschau\.pdf|status-link|customer-link|Failed to load resource/.test(m.text())) fehler.push(m.text());
});
await page.route("**/*", (route) => {
  const url = new URL(route.request().url());
  return url.hostname === "127.0.0.1" ? route.continue() : route.abort();
});

const basis = "http://127.0.0.1:4179/";
async function oeffnen(query, breite, name) {
  await page.setViewportSize({ width: breite, height: breite > 500 ? 900 : 844 });
  await page.goto(`${basis}?${query}`, { waitUntil: "networkidle" });
  await page.locator(".kve-kopf, .kve-leer").first().waitFor();
  await page.waitForTimeout(250);
  const ueber = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(ueber, false, `${name} läuft bei ${breite}px seitlich über`);
  await page.screenshot({ path: path.join(out, `${name}-${breite}.png`) });
}

try {
  const faelle = [
    ["standard", "szenario=standard"],
    ["standard-dunkel", "szenario=standard&dunkel"],
    ["verlauf", "szenario=standard&verlauf"],
    ["formular", "szenario=standard&rechts=formular"],
    ["formular-dunkel", "szenario=standard&rechts=formular&dunkel"],
    ["chat", "szenario=standard&rechts=chat"],
    ["druckt", "szenario=druckt&druckms=600000"],
    ["fehler", "szenario=fehler"],
    ["preis", "szenario=preis"],
    ["preis-dunkel", "szenario=preis&dunkel"],
    ["konflikt", "szenario=konflikt"],
    ["kein-kv", "szenario=kein-kv"],
    ["rekonstruiert", "szenario=rekonstruiert"],
    ["quelle-ohne-stand", "szenario=quelle-ohne-stand"],
    ["ceylan", "szenario=ceylan&rechts=formular"],
    ["ungeprueft", "szenario=ungeprueft&rechts=formular"],
    ["altbestand", "szenario=altbestand&rechts=formular"],
  ];
  for (const [name, q] of faelle) for (const b of [1440, 390]) await oeffnen(q, b, name);

  // Bearbeiten: Feld ändern, Preis im Text → Fehler aus KV_EDITOR_TEXT am Feld.
  await oeffnen("szenario=standard&rechts=formular", 1440, "w-formular-start");
  const vereinbarung = page.locator('section[aria-label="Ergänzende Vereinbarungen"] textarea');
  await vereinbarung.fill("Wir geben 10 % Rabatt.");
  await page.getByRole("button", { name: "Speichern" }).click();
  await page.locator(".kve-feld-fehler").first().waitFor();
  assert.match(await page.locator(".kve-feld-fehler").first().innerText(), /Preisangaben/);
  await page.screenshot({ path: path.join(out, "w-formular-preisfehler-1440.png") });
  // Zu lang → lokal ZU_LANG, Speichern gesperrt.
  await page.locator('input[type="text"]').first().fill("x".repeat(130));
  assert.match(await page.locator(".kve-feld-fehler").first().innerText(), /zu lang/);
  assert.equal(await page.getByRole("button", { name: "Speichern" }).isDisabled(), true);
  await page.locator('input[type="text"]').first().fill("ab 9:00 Uhr");
  await vereinbarung.fill("Der Kunde räumt den Keller selbst leer.");
  await page.getByRole("button", { name: "Speichern" }).click();
  await page.locator(".kve-pille", { hasText: "Stand 4 · Wird gedruckt" }).waitFor();
  await page.screenshot({ path: path.join(out, "w-gespeichert-druckt-1440.png") });
  await page.locator(".kve-pille", { hasText: "Stand 4 · Entwurf" }).waitFor({ timeout: 15_000 });
  await page.screenshot({ path: path.join(out, "w-gespeichert-fertig-1440.png") });

  // Chat: senden, Vorschlagskarte, Übernehmen (n).
  await page.getByRole("button", { name: "KI-Chat" }).click();
  await page.getByPlaceholder("Was soll im KV anders stehen?").fill("Uhrzeit auf halb neun und beim Sofa die Füße abschrauben");
  await page.getByRole("button", { name: "Senden" }).click();
  await page.getByRole("button", { name: /Übernehmen \(2\)/ }).waitFor();
  await page.screenshot({ path: path.join(out, "w-chat-vorschlag-1440.png") });
  await page.locator(".kve-vorschlag input[type=checkbox]").first().uncheck();
  await page.getByRole("button", { name: /Übernehmen \(1\)/ }).click();
  await page.locator(".kve-pille", { hasText: "Stand 5" }).waitFor();
  await page.locator(".kve-vorschlag[data-status=uebernommen]").waitFor();
  await page.screenshot({ path: path.join(out, "w-chat-uebernommen-1440.png") });

  // Pushen ohne Annahme.
  await page.locator(".kve-pille", { hasText: "Stand 5 · Entwurf" }).waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "Pushen" }).click();
  await page.getByRole("dialog").waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, "w-push-einfach-1440.png") });
  await page.getByRole("dialog").getByRole("button", { name: "Pushen" }).click();
  await page.locator(".kve-gepusht").waitFor();
  await page.screenshot({ path: path.join(out, "w-push-fertig-1440.png") });

  // Pushen mit Annahme: Admin mit Haken, Mitglied ohne Knopf.
  await oeffnen("szenario=annahme", 1440, "w-annahme");
  await page.getByRole("button", { name: "Pushen" }).click();
  const knopf = page.getByRole("dialog").getByRole("button", { name: "Annahme aufheben und pushen" });
  assert.equal(await knopf.isDisabled(), true);
  await page.getByLabel("Annahme aufheben, der Kunde nimmt neu an").check();
  await page.screenshot({ path: path.join(out, "w-push-annahme-admin-1440.png") });
  await knopf.click();
  await page.locator(".kve-gepusht", { hasText: "Annahme ist aufgehoben" }).waitFor();
  await oeffnen("szenario=annahme-member", 390, "w-annahme-member");
  await page.getByRole("button", { name: "Pushen" }).click();
  await page.getByText("Nur ein Admin kann ein angenommenes Angebot ändern.").waitFor();
  await page.waitForTimeout(600);
  assert.equal(await page.getByRole("dialog").getByRole("button", { name: /pushen/i }).count(), 0);
  await page.screenshot({ path: path.join(out, "w-push-annahme-member-390.png") });

  // Stand veraltet: Zusammenführen mit Wahl je Feld.
  await oeffnen("szenario=veraltet&rechts=formular", 1440, "w-veraltet");
  await page.locator('input[type="text"]').first().fill("ab 10:00 Uhr");
  await page.locator('section[aria-label="Ergänzende Vereinbarungen"] textarea').fill("Bitte Keller vorher leer räumen.");
  await page.getByRole("button", { name: "Speichern" }).click();
  await page.getByRole("dialog", { name: "Zusammenführen" }).waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, "w-zusammenfuehren-1440.png") });
  await page.getByRole("dialog").getByRole("radio").first().check();
  await page.getByRole("button", { name: "Zusammenführen und speichern" }).click();
  await page.locator(".kve-pille", { hasText: "Stand 5" }).waitFor();

  // Konflikt verwerfen, Kalkulation neu beim Pushen.
  await oeffnen("szenario=konflikt", 1440, "w-konflikt");
  await page.getByRole("button", { name: "verwerfen" }).last().click();
  await page.waitForFunction(() => document.querySelectorAll(".kve-konflikte li").length === 1);
  await oeffnen("szenario=kalkulation-neu", 1440, "w-kalk-neu");
  await page.getByRole("button", { name: "Pushen" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Pushen" }).click();
  await page.getByRole("button", { name: "Auf den neuen KV übertragen" }).waitFor();
  await page.screenshot({ path: path.join(out, "w-kalk-neu-1440.png") });

  // Handy: Schubladen.
  await oeffnen("szenario=standard", 390, "h-start");
  await page.getByRole("button", { name: "KI-Chat" }).click();
  await page.locator(".kve-chat").waitFor();
  await page.screenshot({ path: path.join(out, "h-chat-390.png") });
  await page.locator(".kve-chat .kve-zu").click();
  await page.getByRole("button", { name: "Verlauf" }).click();
  await page.locator(".kve-verlauf").waitFor();
  await page.screenshot({ path: path.join(out, "h-verlauf-390.png") });

  assert.deepEqual(fehler, [], `Fehler im Browser: ${fehler.join(" | ")}`);
  console.log(`Sichtprüfung ok, Screenshots in ${out}`);
} finally {
  await browser.close();
  server.kill();
}

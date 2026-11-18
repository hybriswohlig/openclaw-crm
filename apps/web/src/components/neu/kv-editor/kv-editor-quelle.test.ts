import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiQuelle } from "./kv-editor-quelle";

/**
 * 6b: Jeder Aufruf von `apiQuelle` trifft eine echte Route aus Aufgabe 5 mit passender Methode,
 * und die Antwortform `{ data }` bzw. `{ error: { code, message, daten } }` kommt an.
 */
const API = path.resolve(__dirname, "../../../app/api/v1/deals/[recordId]/kv-editor");

function routeDatei(url: string): string {
  const pfad = new URL(url, "http://x").pathname;
  const rest = pfad.replace(/^\/api\/v1\/deals\/[^/]+\/kv-editor/, "");
  const teile = rest.split("/").filter(Boolean).map((t, i, a) => (a[i - 1] === "staende" ? "[standId]" : t));
  return path.join(API, ...teile, "route.ts");
}

const aufrufe: { url: string; method: string; body: unknown }[] = [];

afterEach(() => {
  aufrufe.length = 0;
  vi.unstubAllGlobals();
});

function fetchMit(antwort: { status: number; body: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      aufrufe.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(antwort.body), { status: antwort.status, headers: { "Content-Type": "application/json" } });
    })
  );
}

describe("apiQuelle gegen die Routen", () => {
  it("jeder Pfad hat eine Route mit der Methode", async () => {
    fetchMit({ status: 200, body: { data: {} } });
    const q = apiQuelle("deal 1");
    await q.ansicht();
    await q.stand("st/1");
    await q.standKopf("st_1");
    await q.standAnlegen({ vorgaengerId: "st_1", setzen: [], zuruecksetzen: [] });
    await q.neuDrucken("st_1");
    await q.pushen("st_1", { erwartetAktuellDokumentId: null });
    await q.konflikte({ standId: "st_1", entscheidungen: [{ schluessel: "a", aktion: "verwerfen" }] });
    await q.uebertragen("st_1");
    await q.chat({ standId: "st_1", text: "Hallo" });
    await q.chatVerlauf();
    const pdf = q.pdfUrl("st_1");
    expect(pdf).toBe("/api/v1/deals/deal%201/kv-editor/staende/st_1/pdf");
    expect(aufrufe[0].url).toBe("/api/v1/deals/deal%201/kv-editor");
    expect(aufrufe[1].url).toBe("/api/v1/deals/deal%201/kv-editor/staende/st%2F1");

    for (const a of [...aufrufe, { url: pdf!, method: "GET", body: undefined }]) {
      const datei = routeDatei(a.url);
      expect(fs.existsSync(datei), `${a.method} ${a.url} → ${datei}`).toBe(true);
      expect(fs.readFileSync(datei, "utf8"), `${a.method} in ${datei}`).toMatch(new RegExp(`export (async function|const) ${a.method}\\b`));
    }
    expect(aufrufe[2].url).toBe("/api/v1/deals/deal%201/kv-editor/staende/st_1/kopf");
    expect(aufrufe.map((a) => a.method)).toEqual(["GET", "GET", "GET", "POST", "POST", "POST", "POST", "POST", "POST", "GET"]);
  });

  it("Fehler mit daten kommen bei fehlerDaten an", async () => {
    const neuester = { id: "st_9", nummer: 9 };
    fetchMit({ status: 409, body: { error: { code: "STAND_VERALTET", message: "neuer", daten: { neuester } } } });
    const r = await apiQuelle("d").standAnlegen({ vorgaengerId: "st_1", setzen: [], zuruecksetzen: [] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.code).toBe("STAND_VERALTET");
    const { fehlerDaten } = await import("./kv-editor-quelle");
    expect(fehlerDaten(r)).toEqual({ neuester });
  });
});

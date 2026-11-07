/**
 * Plan 14: Wer schreibt noch über PUT /api/v1/deals/[id]/quotation?
 *
 * Liest die Zählung aus activity_events (event_type 'quotation.put'), gruppiert nach
 * Quelle und API-Schlüssel (Name aus api_keys) und druckt je Gruppe die Zahl, den
 * letzten Aufruf, bis zu 5 Deals und wie viele abgelehnt wurden. Am Ende steht, ob die
 * Sperre bereit ist (sperreBereit: 30 Tage gezählt, 14 Tage nur die Oberfläche).
 *
 *   npx tsx apps/web/scripts/quotation-schreiber-bericht.ts [--tage 30]
 *
 * Zugang holt das Skript selbst, in dieser Reihenfolge: DATABASE_URL aus der Shell,
 * sonst aus .env.local/.env (Repo-Wurzel und apps/web), sonst `vercel env pull` der
 * Produktion in eine Temp-Datei, die sofort wieder gelöscht wird. Nur SELECT in einer
 * Nur-Lese-Transaktion.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse as dotenvParse } from "dotenv";
import postgres from "postgres";
import {
  QUOTATION_ZAEHL_EVENT,
  sperreBereit,
  type QuotationQuelle,
  type QuotationZaehlung,
} from "../src/lib/dunkel-abschaltung";

const WEB = path.resolve(__dirname, "..");
const WURZEL = path.resolve(WEB, "../..");

function tageAusArgumenten(): number {
  const i = process.argv.indexOf("--tage");
  if (i < 0) return 30;
  const n = Number(process.argv[i + 1]);
  if (!Number.isInteger(n) || n < 1 || n > 3650) {
    console.error("--tage braucht eine ganze Zahl zwischen 1 und 3650.");
    process.exit(1);
  }
  return n;
}

function ausEnvDateien(): string | null {
  for (const datei of [
    path.join(WEB, ".env.local"),
    path.join(WEB, ".env"),
    path.join(WURZEL, ".env.local"),
    path.join(WURZEL, ".env"),
  ]) {
    if (!existsSync(datei)) continue;
    const wert = dotenvParse(readFileSync(datei))["DATABASE_URL"];
    if (wert) return wert;
  }
  return null;
}

function ausVercel(): string | null {
  const ordner = mkdtempSync(path.join(tmpdir(), "quotation-bericht-"));
  const datei = path.join(ordner, "env");
  try {
    execFileSync("vercel", ["env", "pull", datei, "--environment=production", "--yes"], {
      cwd: WEB,
      stdio: ["ignore", "ignore", "inherit"],
    });
    return dotenvParse(readFileSync(datei))["DATABASE_URL"] ?? null;
  } catch (err) {
    console.error(`vercel env pull ging nicht: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

function datenbankUrl(): string {
  const url = process.env.DATABASE_URL || ausEnvDateien() || ausVercel();
  if (!url) {
    console.error("Keine DATABASE_URL gefunden (Shell, .env.local, vercel env pull).");
    process.exit(1);
  }
  return url;
}

function istLokal(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

interface Zeile {
  am: Date;
  z: QuotationZaehlung;
}

interface Gruppe {
  quelle: QuotationQuelle;
  apiKeyId: string | null;
  zahl: number;
  abgelehnt: number;
  letzter: Date;
  deals: string[];
}

function gruppieren(zeilen: Zeile[]): Gruppe[] {
  const m = new Map<string, Gruppe>();
  // Neueste zuerst, damit `deals` die zuletzt beschriebenen nennt.
  for (const { am, z } of [...zeilen].sort((a, b) => b.am.getTime() - a.am.getTime())) {
    const k = `${z.quelle}|${z.apiKeyId ?? ""}`;
    const g = m.get(k) ?? { quelle: z.quelle, apiKeyId: z.apiKeyId ?? null, zahl: 0, abgelehnt: 0, letzter: am, deals: [] };
    g.zahl += 1;
    if (z.abgelehnt) g.abgelehnt += 1;
    if (g.deals.length < 5 && !g.deals.includes(z.dealRecordId)) g.deals.push(z.dealRecordId);
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.zahl - a.zahl);
}

async function main() {
  const tage = tageAusArgumenten();
  const url = datenbankUrl();
  const sql = postgres(url, { max: 1, ssl: istLokal(url) ? false : "require", onnotice: () => {} });
  try {
    const { zeilen, seit, namen } = await sql.begin("read only", async (txRoh) => {
      // postgres.js typisiert TransactionSql ohne Aufrufsignatur (Omit); zur Laufzeit ist es sql.
      const tx = txRoh as unknown as postgres.Sql;
      const ab = new Date(Date.now() - tage * 24 * 60 * 60 * 1000);
      const roh = await tx<{ created_at: Date; payload: QuotationZaehlung }[]>`
        select created_at, payload from activity_events
        where event_type = ${QUOTATION_ZAEHL_EVENT} and created_at >= ${ab}
        order by created_at`;
      const [erst] = await tx<{ seit: Date | null }[]>`
        select min(created_at) as seit from activity_events where event_type = ${QUOTATION_ZAEHL_EVENT}`;
      const ids = [...new Set(roh.map((r) => r.payload.apiKeyId).filter((x): x is string => !!x))];
      const schluessel = ids.length
        ? await tx<{ id: string; name: string; revoked_at: Date | null }[]>`
            select id, name, revoked_at from api_keys where id in ${tx(ids)}`
        : [];
      return {
        zeilen: roh.map((r) => ({ am: new Date(r.created_at), z: r.payload })),
        seit: erst?.seit ? new Date(erst.seit) : null,
        namen: new Map(schluessel.map((s) => [s.id, s.revoked_at ? `${s.name} (widerrufen)` : s.name])),
      };
    });

    const jetzt = new Date();
    console.log(`PUT /quotation in den letzten ${tage} Tagen: ${zeilen.length} Aufrufe`);
    console.log(`Zählung seit: ${seit ? seit.toISOString() : "noch kein Ereignis"}`);
    console.log("");
    for (const g of gruppieren(zeilen)) {
      const schluessel = g.apiKeyId ? `, Schlüssel ${namen.get(g.apiKeyId) ?? "unbekannt"} (${g.apiKeyId})` : "";
      console.log(`${g.quelle}${schluessel}`);
      console.log(`  Aufrufe ${g.zahl}, davon abgelehnt ${g.abgelehnt}, zuletzt ${g.letzter.toISOString()}`);
      console.log(`  Deals: ${g.deals.join(", ")}`);
    }
    if (zeilen.length) console.log("");

    const bereit = seit
      ? sperreBereit(seit, zeilen.map(({ am, z }) => ({ quelle: z.quelle, am })), jetzt)
      : { bereit: false, gruende: ["noch nicht gezählt"] };
    console.log(`Sperre bereit (QUOTATION_PUT_STUFE=sperren): ${bereit.bereit ? "ja" : "nein"}`);
    for (const g of bereit.gruende) console.log(`  - ${g}`);
    if (tage < 14) console.log("  Hinweis: mit --tage unter 14 sieht die Prüfung nicht das ganze Ruhefenster.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

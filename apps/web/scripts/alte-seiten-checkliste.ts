/**
 * Plan 14, Task L: darf die alte Oberfläche gelöscht werden?
 *
 *   npx tsx apps/web/scripts/alte-seiten-checkliste.ts --umleitung-seit YYYY-MM-DD [--entschieden /email,/tasks] [--inhaber-okay YYYY-MM-DD]
 *
 * Liest `activity_events` (`alte_seite.aufruf` der letzten 14 Tage, `quotation.put`)
 * und druckt `loeschenErlaubt` mit allen offenen Punkten. Exit 0 in beiden Fällen
 * (Bericht). Exit 1 nur bei falschen Argumenten oder wenn die Datenbank fehlt.
 *
 * Zugang holt das Skript selbst, in dieser Reihenfolge: DATABASE_URL aus der Shell,
 * sonst aus .env.local/.env (Repo-Wurzel und apps/web), sonst `vercel env pull` der
 * Produktion in eine Temp-Datei, die sofort wieder gelöscht wird. Nur SELECT in einer
 * Nur-Lese-Transaktion. created_at ist timestamp ohne Zone (UTC gespeichert); das Skript
 * liest es ausdrücklich als UTC, sonst rechnet postgres.js in der Ortszeit des Rechners.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as dotenvParse } from "dotenv";
import postgres from "postgres";
import { neuImportiertAlt } from "./alt-importe";
import {
  FENSTER_TAGE,
  VON_HAND,
  abgelehnteNachQuelle,
  abgelehntPunkt,
  argumenteLesen,
  offeneZiele,
  quotationGesperrtSeit,
  umgeleiteteAufrufe,
  type AufrufZeile,
} from "./alte-seiten-checkliste-logik";
import {
  ALT_AUFRUF_EVENT,
  QUOTATION_ZAEHL_EVENT,
  loeschenErlaubt,
  type AltAufruf,
  type LoeschStand,
  type QuotationZaehlung,
} from "../src/lib/dunkel-abschaltung";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WURZEL = path.resolve(WEB, "../..");
const TAG_MS = 24 * 60 * 60 * 1000;

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
  const ordner = mkdtempSync(path.join(tmpdir(), "alte-seiten-checkliste-"));
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

function alsAufruf(payload: unknown): AltAufruf | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Partial<AltAufruf>;
  if (typeof p.pfad !== "string") return null;
  const ui = p.ui === "neu" || p.ui === "alt" ? p.ui : null;
  return { pfad: p.pfad, ui, mitAlt: p.mitAlt === true };
}

function alsZaehlung(payload: unknown): { stufe: string; abgelehnt: boolean; quelle: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Partial<QuotationZaehlung>;
  return {
    stufe: typeof p.stufe === "string" ? p.stufe : "zaehlen",
    abgelehnt: p.abgelehnt === true,
    quelle: typeof p.quelle === "string" ? p.quelle : "unbekannt",
  };
}

function tag(datum: Date): string {
  return datum.toISOString().slice(0, 10);
}

async function main() {
  const gelesen = argumenteLesen(process.argv.slice(2));
  if (!gelesen.ok) {
    console.error(gelesen.fehler);
    process.exit(1);
  }
  const arg = gelesen.wert;
  const jetzt = new Date();
  const url = datenbankUrl();
  const sql = postgres(url, { max: 1, ssl: istLokal(url) ? false : "require", onnotice: () => {} });
  try {
    const ab = new Date(jetzt.getTime() - FENSTER_TAGE * TAG_MS);
    const roh = await sql.begin("read only", async (txRoh) => {
      // postgres.js typisiert TransactionSql ohne Aufrufsignatur (Omit); zur Laufzeit ist es sql.
      const tx = txRoh as unknown as postgres.Sql;
      const aufrufe = await tx<{ created_at: Date; payload: AltAufruf }[]>`
        select created_at at time zone 'UTC' as created_at, payload from activity_events
        where event_type = ${ALT_AUFRUF_EVENT} and created_at >= ${ab}
        order by created_at`;
      const quotation = await tx<{ created_at: Date; payload: QuotationZaehlung }[]>`
        select created_at at time zone 'UTC' as created_at, payload from activity_events
        where event_type = ${QUOTATION_ZAEHL_EVENT}
        order by created_at`;
      return { aufrufe, quotation };
    });

    const zeilen: AufrufZeile[] = [];
    for (const r of roh.aufrufe) {
      const a = alsAufruf(r.payload);
      if (!a) continue;
      zeilen.push({ am: new Date(r.created_at), pfad: a.pfad, ui: a.ui, mitAlt: a.mitAlt });
    }
    const quotation = roh.quotation.flatMap((r) => {
      const z = alsZaehlung(r.payload);
      return z ? [{ am: new Date(r.created_at), ...z }] : [];
    });

    const gruppen = umgeleiteteAufrufe(zeilen);
    const gesperrt = quotationGesperrtSeit(quotation.map((z) => ({ am: z.am, stufe: z.stufe })));
    const importe = neuImportiertAlt(path.join(WEB, "src"));
    const ziele = offeneZiele(arg.entschieden);
    const abgelehnt = abgelehnteNachQuelle(
      quotation.map((z) => ({ am: z.am, quelle: z.quelle, abgelehnt: z.abgelehnt })),
      jetzt
    );
    const abgelehntSumme = abgelehnt.reduce((s, g) => s + g.zahl, 0);

    const stand: LoeschStand = {
      umleitungAnSeit: arg.umleitungSeit,
      altAufrufe14Tage: gruppen.reduce((s, g) => s + g.zahl, 0),
      quotationGesperrtSeit: gesperrt,
      neuImportiertAlt: [...new Set(importe.map((f) => f.datei))],
      offeneZiele: ziele,
      inhaberOkay: arg.inhaberOkay !== null,
    };
    const ergebnis = loeschenErlaubt(stand, jetzt);
    const extra = abgelehntPunkt(abgelehntSumme);
    const offen = extra ? [...ergebnis.offen, extra] : [...ergebnis.offen];
    const erlaubt = ergebnis.erlaubt && extra === null;

    console.log("Lösch-Checkliste alter Seiten");
    console.log(`Umleitung an seit: ${tag(arg.umleitungSeit)}`);
    console.log(`Inhaber-Okay: ${arg.inhaberOkay ? tag(arg.inhaberOkay) : "fehlt"}`);
    console.log("");
    console.log("Aufrufe umgeleiteter alter Pfade in 14 Tagen (mit alt=1 oder Oberfläche neu):");
    if (gruppen.length === 0) console.log("  keine");
    for (const g of gruppen) console.log(`  ${g.pfad}  ${g.zahl}  zuletzt ${g.letzter.toISOString()}`);
    console.log("");
    console.log("Abgelehnte PUT /quotation in 14 Tagen:");
    if (abgelehnt.length === 0) console.log("  keine");
    for (const g of abgelehnt) console.log(`  ${g.quelle}  ${g.zahl}`);
    console.log("");
    console.log(`PUT /quotation gesperrt seit: ${gesperrt ? gesperrt.toISOString() : "nicht gesperrt"}`);
    console.log("");
    console.log("Neue Oberfläche importiert alte Module:");
    if (importe.length === 0) console.log("  keine");
    for (const f of importe) console.log(`  ${f.datei}  ${f.import}`);
    console.log("");
    console.log("Offene Ziele ohne Entscheidung:");
    if (ziele.length === 0) console.log("  keine");
    for (const z of ziele) console.log(`  ${z}`);
    console.log("");
    console.log("Offene Punkte:");
    if (offen.length === 0) console.log("  keine");
    for (const o of offen) console.log(`  - ${o}`);
    console.log("");
    console.log("Von Hand prüfen:");
    for (const z of VON_HAND) console.log(`  - ${z}`);
    console.log("");
    console.log(`Löschen erlaubt: ${erlaubt ? "ja" : "nein"}`);
  } finally {
    await sql.end();
  }
}

function direktAufgerufen(): boolean {
  const einstieg = process.argv[1];
  if (!einstieg) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(einstieg)).href;
  } catch {
    return import.meta.url === pathToFileURL(path.resolve(einstieg)).href;
  }
}

// Nicht beim Import ausführen (Tests laden nur die Logik). Entspricht require.main === module.
if (direktAufgerufen()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

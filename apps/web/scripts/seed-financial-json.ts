/**
 * Load Neon table exports (JSON arrays) into the financial database.
 *
 * Prerequisites: run scripts/financial-neon-schema.sql on the Neon DB first.
 *
 * Usage (from apps/web, with FINANCIAL_DATABASE_URL in .env.local):
 *   pnpm exec tsx scripts/seed-financial-json.ts \
 *     ~/Downloads/zahlungen.json ~/Downloads/ausgaben.json \
 *     ~/Downloads/mitarbeiter_konten.json ~/Downloads/mitarbeiter_saldo.json
 *
 * Replace all rows (truncate then insert):
 *   pnpm exec tsx scripts/seed-financial-json.ts --replace \
 *     ~/Downloads/zahlungen.json ...
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { config } from "dotenv";
import postgres from "postgres";
import { normalizeDatabaseUrl } from "../src/db/normalize-database-url";

for (const p of [resolve(process.cwd(), ".env.local"), resolve(process.cwd(), "../../.env.local")]) {
  if (existsSync(p)) config({ path: p });
}

function getFinancialUrl(): string {
  const raw = process.env.FINANCIAL_DATABASE_URL || process.env.DATABASE_URL;
  const url = normalizeDatabaseUrl(raw);
  if (!url) throw new Error("Set FINANCIAL_DATABASE_URL (or DATABASE_URL) in .env.local");
  return url;
}

function sslFor(url: string): "require" | undefined {
  try {
    const host = new URL(url.replace(/^postgresql:/i, "https:")).hostname;
    if (host.endsWith("neon.tech") || host.endsWith("neon.build")) return "require";
  } catch {
    /* ignore */
  }
  return process.env.NODE_ENV === "production" ? "require" : undefined;
}

function toDate(s: string): string {
  return String(s).slice(0, 10);
}

function emptyToNull(s: unknown): string | null {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  return t === "" ? null : t;
}

function readJson<T>(path: string): T[] {
  if (!existsSync(path)) throw new Error(`File not found: ${path}`);
  const raw = readFileSync(path, "utf8");
  const data = JSON.parse(raw) as unknown;
  if (!Array.isArray(data)) throw new Error(`Expected JSON array in ${path}`);
  return data as T[];
}

async function main() {
  const args = process.argv.slice(2);
  const replace = args[0] === "--replace";
  const files = replace ? args.slice(1) : args;
  if (files.length !== 4) {
    console.error(
      "Usage: tsx scripts/seed-financial-json.ts [--replace] <zahlungen.json> <ausgaben.json> <mitarbeiter_konten.json> <mitarbeiter_saldo.json>"
    );
    process.exit(1);
  }

  const [zahlungenPath, ausgabenPath, kontenPath, saldoPath] = files.map((f) => resolve(f));

  const url = getFinancialUrl();
  const sql = postgres(url, { max: 1, ssl: sslFor(url) });

  try {
    if (replace) {
      await sql`TRUNCATE mitarbeiter_saldo, mitarbeiter_konten, zahlungen, ausgaben RESTART IDENTITY`;
      console.log("Truncated financial tables (--replace).");
    }

    const zahlungen = readJson<{
      id: number;
      auftrag_nr: string;
      datum: string;
      betrag: number;
      zahler: string;
      zahlungsart: string;
      referenz?: string;
      notiz?: string;
      erstellt_am: string;
    }>(zahlungenPath);

    for (const z of zahlungen) {
      await sql`
        INSERT INTO zahlungen (id, auftrag_nr, datum, betrag, zahler, zahlungsart, referenz, notiz, erstellt_am)
        VALUES (
          ${z.id},
          ${z.auftrag_nr},
          ${toDate(z.datum)}::date,
          ${z.betrag},
          ${z.zahler},
          ${z.zahlungsart},
          ${emptyToNull(z.referenz)},
          ${emptyToNull(z.notiz)},
          ${z.erstellt_am}::timestamptz
        )
        ON CONFLICT (id) DO UPDATE SET
          auftrag_nr = EXCLUDED.auftrag_nr,
          datum = EXCLUDED.datum,
          betrag = EXCLUDED.betrag,
          zahler = EXCLUDED.zahler,
          zahlungsart = EXCLUDED.zahlungsart,
          referenz = EXCLUDED.referenz,
          notiz = EXCLUDED.notiz,
          erstellt_am = EXCLUDED.erstellt_am
      `;
    }
    console.log(`zahlungen: ${zahlungen.length} rows`);

    const ausgaben = readJson<{
      id: number;
      datum: string;
      betrag: number;
      empfaenger: string;
      beschreibung?: string;
      kategorie?: string;
      zahlungsart?: string;
      auftrag_nr?: string;
      firma?: string;
      beleg_datei?: string;
      erstellt_am: string;
    }>(ausgabenPath);

    for (const a of ausgaben) {
      await sql`
        INSERT INTO ausgaben (id, datum, betrag, empfaenger, beschreibung, kategorie, zahlungsart, auftrag_nr, firma, beleg_datei, erstellt_am)
        VALUES (
          ${a.id},
          ${toDate(a.datum)}::date,
          ${a.betrag},
          ${a.empfaenger},
          ${emptyToNull(a.beschreibung)},
          ${emptyToNull(a.kategorie)},
          ${emptyToNull(a.zahlungsart)},
          ${emptyToNull(a.auftrag_nr)},
          ${emptyToNull(a.firma)},
          ${emptyToNull(a.beleg_datei)},
          ${a.erstellt_am}::timestamptz
        )
        ON CONFLICT (id) DO UPDATE SET
          datum = EXCLUDED.datum,
          betrag = EXCLUDED.betrag,
          empfaenger = EXCLUDED.empfaenger,
          beschreibung = EXCLUDED.beschreibung,
          kategorie = EXCLUDED.kategorie,
          zahlungsart = EXCLUDED.zahlungsart,
          auftrag_nr = EXCLUDED.auftrag_nr,
          firma = EXCLUDED.firma,
          beleg_datei = EXCLUDED.beleg_datei,
          erstellt_am = EXCLUDED.erstellt_am
      `;
    }
    console.log(`ausgaben: ${ausgaben.length} rows`);

    const konten = readJson<{
      id: number;
      mitarbeiter: string;
      datum: string;
      typ: string;
      betrag: number;
      beschreibung?: string;
      auftrag_nr?: string;
      status: string;
      zahlungsart?: string;
      notiz?: string;
      erstellt_am: string;
    }>(kontenPath);

    for (const k of konten) {
      await sql`
        INSERT INTO mitarbeiter_konten (id, mitarbeiter, datum, typ, betrag, beschreibung, auftrag_nr, status, zahlungsart, notiz, erstellt_am)
        VALUES (
          ${k.id},
          ${k.mitarbeiter},
          ${toDate(k.datum)}::date,
          ${k.typ},
          ${k.betrag},
          ${emptyToNull(k.beschreibung)},
          ${emptyToNull(k.auftrag_nr)},
          ${k.status},
          ${emptyToNull(k.zahlungsart)},
          ${emptyToNull(k.notiz)},
          ${k.erstellt_am}::timestamptz
        )
        ON CONFLICT (id) DO UPDATE SET
          mitarbeiter = EXCLUDED.mitarbeiter,
          datum = EXCLUDED.datum,
          typ = EXCLUDED.typ,
          betrag = EXCLUDED.betrag,
          beschreibung = EXCLUDED.beschreibung,
          auftrag_nr = EXCLUDED.auftrag_nr,
          status = EXCLUDED.status,
          zahlungsart = EXCLUDED.zahlungsart,
          notiz = EXCLUDED.notiz,
          erstellt_am = EXCLUDED.erstellt_am
      `;
    }
    console.log(`mitarbeiter_konten: ${konten.length} rows`);

    const saldo = readJson<{
      mitarbeiter: string;
      schulden_gesamt: number;
      gezahlt_gesamt: number;
      saldo: number;
      anzahl_transaktionen: number;
    }>(saldoPath);

    for (const s of saldo) {
      await sql`
        INSERT INTO mitarbeiter_saldo (mitarbeiter, schulden_gesamt, gezahlt_gesamt, saldo, anzahl_transaktionen)
        VALUES (${s.mitarbeiter}, ${s.schulden_gesamt}, ${s.gezahlt_gesamt}, ${s.saldo}, ${s.anzahl_transaktionen})
        ON CONFLICT (mitarbeiter) DO UPDATE SET
          schulden_gesamt = EXCLUDED.schulden_gesamt,
          gezahlt_gesamt = EXCLUDED.gezahlt_gesamt,
          saldo = EXCLUDED.saldo,
          anzahl_transaktionen = EXCLUDED.anzahl_transaktionen
      `;
    }
    console.log(`mitarbeiter_saldo: ${saldo.length} rows`);

    await sql`SELECT setval(pg_get_serial_sequence('zahlungen', 'id'), COALESCE((SELECT MAX(id) FROM zahlungen), 1))`;
    await sql`SELECT setval(pg_get_serial_sequence('ausgaben', 'id'), COALESCE((SELECT MAX(id) FROM ausgaben), 1))`;
    await sql`SELECT setval(pg_get_serial_sequence('mitarbeiter_konten', 'id'), COALESCE((SELECT MAX(id) FROM mitarbeiter_konten), 1))`;

    console.log("Done. Sequences synced to MAX(id).");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

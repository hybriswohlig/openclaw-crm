import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { queryFinancialDb } from "@/lib/financial-db";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  let ausgaben;
  let zahlungen;
  let konten;
  let saldo;
  try {
    [ausgaben, zahlungen, konten, saldo] = await Promise.all([
    queryFinancialDb((sql) => sql`
      SELECT id, datum, betrag, empfaenger, beschreibung, kategorie, zahlungsart, auftrag_nr, firma, erstellt_am
      FROM ausgaben ORDER BY datum DESC
    `),
    queryFinancialDb((sql) => sql`
      SELECT id, auftrag_nr, datum, betrag, zahler, zahlungsart, referenz, notiz, erstellt_am
      FROM zahlungen ORDER BY datum DESC
    `),
    queryFinancialDb((sql) => sql`
      SELECT id, mitarbeiter, datum, typ, betrag, beschreibung, auftrag_nr, status, zahlungsart, notiz, erstellt_am
      FROM mitarbeiter_konten ORDER BY datum DESC
    `),
    queryFinancialDb((sql) => sql`
      SELECT mitarbeiter, schulden_gesamt, gezahlt_gesamt, saldo, anzahl_transaktionen
      FROM mitarbeiter_saldo
    `),
    ]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const missing =
      /relation "[^"]+" does not exist/i.test(msg) || (e as { code?: string })?.code === "42P01";
    if (missing) {
      return NextResponse.json(
        {
          error: {
            code: "FINANCIAL_SCHEMA_MISSING",
            message:
              "Financial database tables are missing. Run the SQL script in your Neon project (SQL Editor).",
            hint: "Repo file: apps/web/scripts/financial-neon-schema.sql — creates ausgaben, zahlungen, mitarbeiter_konten, mitarbeiter_saldo.",
            detail: msg,
          },
        },
        { status: 503 }
      );
    }
    throw e;
  }

  const totalAusgaben = ausgaben.reduce((s, r) => s + Number(r.betrag), 0);
  const totalZahlungen = zahlungen.reduce((s, r) => s + Number(r.betrag), 0);

  const ausgabenByKategorie: Record<string, number> = {};
  for (const row of ausgaben) {
    const k = row.kategorie || "Sonstiges";
    ausgabenByKategorie[k] = (ausgabenByKategorie[k] || 0) + Number(row.betrag);
  }

  const ausgabenByFirma: Record<string, number> = {};
  for (const row of ausgaben) {
    const f = row.firma || "Unbekannt";
    ausgabenByFirma[f] = (ausgabenByFirma[f] || 0) + Number(row.betrag);
  }

  const ausgabenByZahlungsart: Record<string, number> = {};
  for (const row of ausgaben) {
    const z = row.zahlungsart || "sonstig";
    ausgabenByZahlungsart[z] = (ausgabenByZahlungsart[z] || 0) + Number(row.betrag);
  }

  return success({
    summary: {
      totalAusgaben,
      totalZahlungen,
      nettoErgebnis: totalZahlungen - totalAusgaben,
      anzahlAusgaben: ausgaben.length,
      anzahlZahlungen: zahlungen.length,
    },
    breakdowns: {
      ausgabenByKategorie,
      ausgabenByFirma,
      ausgabenByZahlungsart,
    },
    mitarbeiterSaldo: saldo,
    recentAusgaben: ausgaben.slice(0, 20),
    recentZahlungen: zahlungen.slice(0, 20),
    mitarbeiterKonten: konten,
  });
}

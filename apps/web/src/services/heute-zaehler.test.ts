import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

/**
 * Zähler der Seitenleiste: die schlanke Zählabfrage (`ladeNavZaehler`) muss
 * dieselben Zahlen liefern wie die Chips des Boards (`ladeLeadsRoh` →
 * `chipsZaehlen().warten` und offene Kategorien). Beide Wege laufen über
 * dieselbe Fixture: Weg A über die echte Board-Pipeline, Weg B über die
 * Zeilen, die die Zählabfrage (GROUP BY Stufe) für diese Deals liefert.
 */
const mocks = vi.hoisted(() => ({ execute: vi.fn(), ladeFirmen: vi.fn() }));

vi.mock("@/db", () => ({ db: { execute: mocks.execute } }));
vi.mock("@/services/lagekarte/laden", () => ({ ladeFirmen: mocks.ladeFirmen }));

import { chipsZaehlen } from "@/lib/leads-board-bauen";
import { navZaehlerAus } from "@/lib/plan-bauen";
import { kasseZaehlerCacheLeeren } from "./kasse";
import { ladeLeadsRoh, type DbZeile } from "./leads-board";
import { NAV_ZAEHLER_CACHE_MS, ladeNavZaehler, navZaehlerCacheLeeren, zaehlerLesen } from "./heute";

const JETZT = new Date("2026-11-06T11:00:00.000Z");
const dialect = new PgDialect();

const STUFEN = [
  { id: "s_neu", title: "Neue Anfrage", stage_category: "open_new", sort_order: 0, is_active: true },
  { id: "s_kontakt", title: "In Kontakt", stage_category: "open_engaged", sort_order: 1, is_active: true },
  { id: "s_angebot", title: "Angebot", stage_category: "quoted", sort_order: 2, is_active: true },
  // Inaktive englische Dublette ohne Kategorie: Kategorie nur über den Titel.
  { id: "s_alt", title: "Quoted", stage_category: null, sort_order: 2, is_active: false },
  { id: "s_geplant", title: "Geplant", stage_category: "booked", sort_order: 3, is_active: true },
  { id: "s_durch", title: "Durchgeführt", stage_category: "done_unpaid", sort_order: 4, is_active: true },
  { id: "s_bezahlt", title: "Bezahlt", stage_category: "paid", sort_order: 5, is_active: true },
  { id: "s_verloren", title: "Verloren", stage_category: "lost", sort_order: 6, is_active: true },
  { id: "s_kein", title: "Kein Lead", stage_category: "kein_lead", sort_order: 7, is_active: true },
  { id: "s_sonder", title: "Sonderfall", stage_category: null, sort_order: 8, is_active: true },
];

/** Deal-Fixture: Stufe (roh, auch unbekannt oder leer) und Wartet-Zeile. */
const FIXTURE: { id: string; stufe: string | null; wartet: "uns" | "kunde" | "niemand" | null }[] = [
  { id: "a", stufe: "s_neu", wartet: "uns" },
  { id: "b", stufe: "s_neu", wartet: null },
  { id: "c", stufe: "s_kontakt", wartet: "kunde" },
  { id: "d", stufe: "s_angebot", wartet: "uns" },
  { id: "e", stufe: "s_alt", wartet: "uns" },
  { id: "f", stufe: "s_geplant", wartet: "uns" },
  { id: "g", stufe: "s_durch", wartet: "uns" },
  { id: "h", stufe: "s_bezahlt", wartet: "uns" },
  { id: "i", stufe: "s_verloren", wartet: "uns" },
  { id: "j", stufe: "s_kein", wartet: "uns" },
  { id: "k", stufe: "s_weg", wartet: "uns" },
  { id: "l", stufe: null, wartet: "uns" },
  { id: "m", stufe: "s_sonder", wartet: "niemand" },
  { id: "n", stufe: "s_angebot", wartet: "niemand" },
];

function dbZeile(id: string, stufe: string | null, wartet: string | null): DbZeile {
  const leer = (k: string) => [k, null] as const;
  const felder = [
    "nummer", "name", "umzug_am", "von", "nach", "firma_id", "quelle_id", "wert", "besichtigung_am", "verlust_grund",
    "waiting_since", "waiting_reason", "festpreis", "ist_stunden", "service_type", "mit_entruempelung", "gueltig_bis",
    "paket_option_id", "ohne_version", "angebot_version_gesendet_am", "positionen", "optionen", "annahme_cent",
    "angenommen_am", "zuletzt_geoeffnet", "termin_auswahl", "gesperrt_version", "gesperrt_cent", "gesperrt_gesendet_am",
    "gesperrt_team_soll", "entwurf_version", "entwurf_cent", "entwurf_team_soll", "rechner_festpreis", "rechner_team_soll",
    "kv_erstes_am", "rechnung_am", "zahlungen", "team_namen", "letzte_nachricht_am", "telefone", "meldungen",
  ].map(leer);
  return {
    ...Object.fromEntries(felder),
    id,
    erstellt_am: "2026-10-27 11:00:00",
    stufe_id: stufe,
    waiting_on: wartet,
    hat_angebot: false,
    hat_annahme: false,
    hat_rechner: false,
    fotos: "0",
  } as DbZeile;
}

/** Was `zaehlerLesen` für die Fixture liefert: GROUP BY bekannte Stufe (unbekannte und leere = null). */
function gruppenZeilen() {
  const gruppen = new Map<string, { stufe_id: string | null; titel: string | null; kategorie: string | null; anzahl: number; warten: number }>();
  for (const f of FIXTURE) {
    const s = STUFEN.find((x) => x.id === f.stufe) ?? null;
    const key = s?.id ?? "";
    const g = gruppen.get(key) ?? { stufe_id: s?.id ?? null, titel: s?.title ?? null, kategorie: s?.stage_category ?? null, anzahl: 0, warten: 0 };
    g.anzahl++;
    if (f.wartet === "uns") g.warten++;
    gruppen.set(key, g);
  }
  // Postgres liefert count als Text (bigint).
  return [...gruppen.values()].map((g) => ({ ...g, anzahl: String(g.anzahl), warten: String(g.warten) }));
}

/** Zählabfrage und Deal-Zeilen, die `ladeLeadsRoh` (für die Kasse) sieht. */
let zaehlerZeilen: unknown[] = [];
let dealZeilen: DbZeile[] = [];

function sqlText(q: SQL) {
  return dialect.sqlToQuery(q).sql;
}

beforeEach(() => {
  vi.clearAllMocks();
  navZaehlerCacheLeeren();
  kasseZaehlerCacheLeeren();
  mocks.ladeFirmen.mockResolvedValue([]);
  zaehlerZeilen = [];
  dealZeilen = [];
  mocks.execute.mockImplementation(async (q: SQL) => {
    const text = sqlText(q);
    if (text.includes("count(*) FILTER")) return zaehlerZeilen;
    if (text.includes("FROM statuses")) return STUFEN;
    if (text.includes("erstellt_am")) return dealZeilen;
    return [];
  });
});

describe("ladeNavZaehler (schlanke Zählabfrage)", () => {
  it("liefert dieselben Heute- und Leads-Zahlen wie die Board-Chips über dieselbe Fixture", async () => {
    dealZeilen = FIXTURE.map((f) => dbZeile(f.id, f.stufe, f.wartet));
    zaehlerZeilen = gruppenZeilen();
    const { eintraege } = await ladeLeadsRoh("ws_1", JETZT);
    const board = navZaehlerAus(eintraege);
    expect(board.heute).toBe(chipsZaehlen(eintraege).warten);
    expect(board.kasse).toBe(0);

    mocks.execute.mockClear();
    const schlank = await ladeNavZaehler("ws_1", JETZT);

    expect(schlank.heute).toBe(board.heute);
    expect(schlank.leads).toBe(board.leads);
    // a, d, e, f, g, k, l warten (Endstufen bezahlt, verloren, kein Lead nicht); offen a, b, c, d, e, n.
    // Kasse: nur g ist Durchgeführt ohne Rechnung.
    expect(schlank).toEqual({ heute: 7, leads: 6, kasse: 1 });
    const zaehlerCalls = mocks.execute.mock.calls.filter((c) => sqlText(c[0] as SQL).includes("count(*) FILTER"));
    expect(zaehlerCalls).toHaveLength(1);
  });

  it("Abfrage: Workspace-Objekt, lebende Deals, Stufe wie das Board, nichts Schweres", async () => {
    expect(await zaehlerLesen("ws_1")).toEqual([]);
    const q = dialect.sqlToQuery(mocks.execute.mock.calls[0][0] as SQL);
    expect(q.params).toEqual(["ws_1"]);
    expect(q.sql).toMatch(/FROM objects o WHERE o\.workspace_id = \$1 AND o\.slug = 'deals'/);
    expect(q.sql).toMatch(/r\.object_id IN \(SELECT obj\.id FROM obj\) AND r\.deleted_at IS NULL/);
    expect(q.sql).toMatch(/a\.object_id IN \(SELECT obj\.id FROM obj\) AND a\.slug = 'stage'/);
    expect(q.sql).toMatch(/INNER JOIN d ON d\.id = rv\.record_id/);
    expect(q.sql).toMatch(/ORDER BY rv\.record_id, rv\.sort_order, rv\.id/);
    expect(q.sql).toMatch(/s\.attribute_id IN \(SELECT stage_attr\.id FROM stage_attr\)/);
    expect(q.sql).toMatch(/LEFT JOIN deal_workflow_state w ON w\.record_id = d\.id/);
    expect(q.sql).toMatch(/count\(\*\) FILTER \(WHERE w\.waiting_on = 'uns'\)/);
    expect(q.sql).not.toMatch(/file_content|rechner_result|\bSELECT \*|\.\*/);
  });

  it("30 s Cache je Workspace; gleichzeitige Aufrufe teilen sich die Abfrage; Fehler werden nicht gemerkt", async () => {
    zaehlerZeilen = [{ stufe_id: "s_neu", titel: "Neue Anfrage", kategorie: "open_new", anzahl: "2", warten: "1" }];
    const t = JETZT.getTime();
    const [a, b] = await Promise.all([ladeNavZaehler("ws_1", JETZT), ladeNavZaehler("ws_1", JETZT)]);
    expect(a).toEqual({ heute: 1, leads: 2, kasse: 0 });
    expect(b).toEqual(a);
    const einmal = mocks.execute.mock.calls.length;
    expect(einmal).toBeGreaterThan(1);

    await ladeNavZaehler("ws_1", new Date(t + NAV_ZAEHLER_CACHE_MS - 1));
    expect(mocks.execute).toHaveBeenCalledTimes(einmal);
    await ladeNavZaehler("ws_2", JETZT);
    expect(mocks.execute.mock.calls.length).toBe(einmal * 2);
    await ladeNavZaehler("ws_1", new Date(t + NAV_ZAEHLER_CACHE_MS));
    expect(mocks.execute.mock.calls.length).toBe(einmal * 3);

    navZaehlerCacheLeeren();
    kasseZaehlerCacheLeeren();
    mocks.execute.mockRejectedValueOnce(new Error("weg"));
    await expect(ladeNavZaehler("ws_1", JETZT)).rejects.toThrow("weg");
    expect(await ladeNavZaehler("ws_1", JETZT)).toEqual({ heute: 1, leads: 2, kasse: 0 });
  });
});

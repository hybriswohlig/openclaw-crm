/**
 * Datenbank-Speicher der Kalkulationsversionen (Tabelle deal_calculation_versions)
 * und der Lader für die Paket-Hebel der Firma. Jede Abfrage ist auf Workspace
 * und Deal begrenzt; nur Entwürfe werden geändert.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { offerPackages } from "@/db/schema/customer-portal";
import { dealCalculationVersions } from "@/db/schema/deal-calculation-versions";
import { resolveDealOperatingCompany } from "./financial";
import { angebotAusVersionSchreiben } from "./quotations";
import type { HebelArt } from "./rechner/kv-posten";
import { centSumme, EntwurfExistiertError, VersionsFehler, type VersionsSpeicher, type VersionsZeile } from "./kalkulation-versionen";

/** Unique-Verletzungen, die "es gibt schon einen Entwurf" bedeuten (paralleles Anlegen). */
const ENTWURF_CONSTRAINTS = new Set(["deal_calculation_versions_ein_entwurf", "deal_calculation_versions_deal_version_unique"]);

/** Postgres 23505 auf einem der Entwurfs-Indizes, auch in `cause` verpackt (DrizzleQueryError). */
export function istEntwurfKonflikt(err: unknown): boolean {
  const gesehen = new Set<unknown>();
  let e: unknown = err;
  while (e && typeof e === "object" && !gesehen.has(e)) {
    gesehen.add(e);
    const f = e as { code?: unknown; constraint_name?: unknown; constraint?: unknown; cause?: unknown };
    const name = typeof f.constraint_name === "string" ? f.constraint_name : typeof f.constraint === "string" ? f.constraint : null;
    if (f.code === "23505" && name !== null && ENTWURF_CONSTRAINTS.has(name)) return true;
    e = f.cause;
  }
  return false;
}

const alsZeile = (z: typeof dealCalculationVersions.$inferSelect): VersionsZeile => z as unknown as VersionsZeile;

export const dbVersionsSpeicher: VersionsSpeicher = {
  async liste(ws, deal) {
    const zeilen = await db
      .select()
      .from(dealCalculationVersions)
      .where(and(eq(dealCalculationVersions.workspaceId, ws), eq(dealCalculationVersions.dealRecordId, deal)))
      .orderBy(asc(dealCalculationVersions.version));
    return zeilen.map(alsZeile);
  },

  async lesen(ws, deal, version) {
    const [z] = await db
      .select()
      .from(dealCalculationVersions)
      .where(
        and(
          eq(dealCalculationVersions.workspaceId, ws),
          eq(dealCalculationVersions.dealRecordId, deal),
          eq(dealCalculationVersions.version, version)
        )
      )
      .limit(1);
    return z ? alsZeile(z) : null;
  },

  async entwurf(ws, deal) {
    const [z] = await db
      .select()
      .from(dealCalculationVersions)
      .where(
        and(
          eq(dealCalculationVersions.workspaceId, ws),
          eq(dealCalculationVersions.dealRecordId, deal),
          eq(dealCalculationVersions.status, "entwurf")
        )
      )
      .limit(1);
    return z ? alsZeile(z) : null;
  },

  async anlegen(z) {
    try {
      const [neu] = await db.insert(dealCalculationVersions).values(z).returning();
      return alsZeile(neu);
    } catch (err) {
      if (istEntwurfKonflikt(err)) throw new EntwurfExistiertError();
      throw err;
    }
  },

  async aktualisieren(id, patch) {
    // id, Deal, Workspace, Nummer und Status ändert nur das Sperren.
    const felder: Partial<VersionsZeile> = { ...patch };
    // Übersteuerungen nur über anhaengen (atomar), nie durch Überschreiben der Liste.
    for (const k of ["id", "workspaceId", "dealRecordId", "version", "status", "createdAt", "overrides"] as const) delete felder[k];
    const [z] = await db
      .update(dealCalculationVersions)
      .set({ ...felder, updatedAt: new Date() })
      .where(and(eq(dealCalculationVersions.id, id), eq(dealCalculationVersions.status, "entwurf")))
      .returning();
    if (!z) throw new VersionsFehler("UNGUELTIG", "Version ist bereits gesperrt.");
    return alsZeile(z);
  },

  async anhaengen(id, u) {
    const t = dealCalculationVersions;
    const [z] = await db
      .update(t)
      .set({ overrides: sql`${t.overrides} || ${JSON.stringify([u])}::jsonb`, updatedAt: new Date() })
      .where(and(eq(t.id, id), eq(t.status, "entwurf")))
      .returning();
    if (!z) throw new VersionsFehler("UNGUELTIG", "Version ist bereits gesperrt.");
    return alsZeile(z);
  },

  async sperrenUndAngebot(ws, deal, id, angebot, kvItems, von, stand) {
    return db.transaction(async (tx) => {
      const jetzt = new Date();
      const t = dealCalculationVersions;
      const [z] = await tx
        .update(dealCalculationVersions)
        .set({
          // Der Stand, aus dem Preis und Posten gebildet wurden: so bleibt die gesperrte Zeile
          // stimmig, auch wenn eine ältere Neuberechnung kurz vorher noch gelandet ist.
          ...(stand?.schnappschuss ? { ...stand.schnappschuss, error: null } : {}),
          status: "gesperrt",
          kvItems,
          priceCents: centSumme(kvItems),
          lockedAt: jetzt,
          lockedBy: von,
          updatedAt: jetzt,
        })
        .where(
          and(
            eq(dealCalculationVersions.id, id),
            eq(dealCalculationVersions.workspaceId, ws),
            eq(dealCalculationVersions.dealRecordId, deal),
            eq(dealCalculationVersions.status, "entwurf"),
            stand ? sql`jsonb_array_length(${t.overrides}) = ${stand.uebersteuerungen}` : undefined
          )
        )
        .returning();
      // Wirft innerhalb der Transaktion: nichts wird geschrieben.
      if (!z) {
        const [jetzig] = await tx.select({ status: t.status }).from(t).where(eq(t.id, id)).limit(1);
        if (stand && jetzig?.status === "entwurf") {
          throw new VersionsFehler("UNGUELTIG", "Die Kalkulation wurde gerade geändert. Bitte erneut sperren.");
        }
        throw new VersionsFehler("UNGUELTIG", "Version ist bereits gesperrt.");
      }
      await angebotAusVersionSchreiben(tx, deal, angebot, id);
      return { version: alsZeile(z) };
    });
  },
};

/** Hebel je Paket-Slug aus den aktiven offer_packages der Firma des Deals; null ohne Firma oder Pakete. */
export async function ladePaketHebel(ws: string, deal: string): Promise<Record<string, HebelArt[]> | null> {
  const firma = await resolveDealOperatingCompany(ws, deal);
  if (!firma) return null;
  const pakete = await db
    .select({ slug: offerPackages.slug, hebel: offerPackages.hebel })
    .from(offerPackages)
    .where(
      and(eq(offerPackages.workspaceId, ws), eq(offerPackages.operatingCompanyRecordId, firma), eq(offerPackages.active, true))
    )
    .orderBy(asc(offerPackages.sortOrder));
  if (pakete.length === 0) return null;
  return Object.fromEntries(pakete.map((p) => [p.slug, p.hebel ?? []]));
}

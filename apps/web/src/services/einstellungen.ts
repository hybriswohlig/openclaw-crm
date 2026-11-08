/**
 * Plan 13: was die Seite Einstellungen zeigt (`GET /api/v1/einstellungen`).
 * Liest nur. Geschrieben wird über die vorhandenen Routen der Pläne 5, 9, 11
 * und 12 (Entscheidung 5). Firmen und API-Schlüssel nur für Admins.
 * Die Antwort enthält nichts, was die Seite nicht zeigt (keine IBAN, AGB,
 * Domain-Daten, Agent-Texte).
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { companySettings } from "@/db/schema/company-settings";
import { markeAusFirmenname } from "@/lib/bewertungen-kunden";
import {
  apiSchluesselAnsicht,
  apiSchluesselSortieren,
  darstellungAus,
  type EinstellungenAntwort,
  type FirmaEinstellungenAnsicht,
} from "@/lib/einstellungen-uebersicht";
import { listApiKeys } from "@/services/api-keys";
import { ladeBewertungModi, MODUS_STANDARD } from "@/services/bewertung-modus";
import { calendarFeeds } from "@/services/calendar/feed-token-store";
import { feedPath } from "@/services/calendar/feed-tokens";
import { ladeFirmenEinstellungen } from "@/services/company-settings";
import { listOfferPackages, listOperatingCompanyPortalSettings } from "@/services/customer-portal-config";
import { getUserSettings } from "@/services/user-settings";

export interface EinstellungenKontext {
  workspaceId: string;
  userId: string;
  workspaceRole: "admin" | "member";
}

async function ladeBuchungImPreis(ws: string): Promise<Map<string, boolean>> {
  const rows = await db
    .select({ ocId: companySettings.operatingCompanyRecordId, an: companySettings.buchungImPreis })
    .from(companySettings)
    .where(eq(companySettings.workspaceId, ws));
  return new Map(rows.map((r) => [r.ocId, r.an === true]));
}

async function ladeFirmen(ws: string): Promise<FirmaEinstellungenAnsicht[]> {
  const [portale, modi, buchung] = await Promise.all([
    listOperatingCompanyPortalSettings(ws),
    ladeBewertungModi(ws),
    ladeBuchungImPreis(ws),
  ]);
  const firmen = await Promise.all(
    portale.map(async (p): Promise<FirmaEinstellungenAnsicht> => {
      const id = p.operatingCompanyRecordId;
      const [einstellungen, pakete] = await Promise.all([ladeFirmenEinstellungen(ws, id), listOfferPackages(ws, id)]);
      const bewertung = modi.get(id) ?? MODUS_STANDARD;
      return {
        id,
        name: p.operatingCompanyName,
        marke: einstellungen.rechnerMarke ?? markeAusFirmenname(p.operatingCompanyName),
        zahlung: einstellungen.zahlung,
        bewertung: {
          modus: bewertung.modus,
          seit: bewertung.seit ? bewertung.seit.toISOString() : null,
          hakenPortal: bewertung.hakenPortal,
        },
        googleReviewUrl: p.googleReviewUrl ?? null,
        portal: {
          enabled: p.enabled,
          signatureEnabled: p.signatureEnabled,
          angebotAusKalkulation: p.angebotAusKalkulation,
          tagespreiseEnabled: p.tagespreiseEnabled,
        },
        pakete: pakete.map((k) => ({ id: k.id, slug: k.slug, name: k.displayName, aktiv: k.active, hebel: k.hebel })),
        zeitposten: einstellungen.zeitposten,
        einsatz: { buchungImPreis: buchung.get(id) === true },
      };
    }),
  );
  return firmen.sort((a, b) => a.name.localeCompare(b.name, "de"));
}

export async function ladeEinstellungen(ctx: EinstellungenKontext, jetzt: Date = new Date()): Promise<EinstellungenAntwort> {
  const admin = ctx.workspaceRole === "admin";
  const [settings, feed, firmen, schluessel] = await Promise.all([
    getUserSettings(ctx.userId),
    calendarFeeds.getActive(ctx.workspaceId, ctx.userId),
    admin ? ladeFirmen(ctx.workspaceId) : Promise.resolve(null),
    admin ? listApiKeys(ctx.workspaceId) : Promise.resolve(null),
  ]);
  return {
    ich: {
      darstellung: darstellungAus(settings.ansichten),
      kalender: {
        pfad: feed ? feedPath(feed.token) : null,
        erstelltAm: feed?.createdAt ? new Date(feed.createdAt).toISOString() : null,
      },
    },
    admin,
    firmen,
    apiSchluessel: schluessel ? schluessel.map((k) => apiSchluesselAnsicht(k, jetzt)).sort(apiSchluesselSortieren) : null,
  };
}

/**
 * Kandidaten der Zahlungserinnerung für einen Workspace.
 * Baut nur die Eingabe; die Entscheidung trifft `erinnerungFaellig`.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents } from "@/db/schema/activity";
import { paymentReminders } from "@/db/schema/deal-invoices";
import { payments } from "@/db/schema/financial";
import { channelAccounts, inboxConversations, inboxMessages } from "@/db/schema/inbox";
import {
  berlinTag,
  erinnerungKanal,
  offenAus,
  type ErinnerungEingabe,
  type ErinnerungKandidat,
  type ErinnerungStand,
  type ErinnerungStatus,
  type FirmenZahlungsregel,
  type RechnungStatus,
} from "@/lib/geld";
import { vornameFuerAnrede } from "@/lib/personen-name";
import { MELDUNG_EREIGNISTYPEN, offeneMeldungen } from "@/lib/zahlungsmeldungen";
import { ladeZahlungsregel } from "@/services/company-settings";
import { ensureCustomerStatusLink, loadContextByToken } from "@/services/customer-portal-data";
import { istCeylanWhatsApp } from "@/services/nachfass/konstanten";
import { sperreAusText } from "@/services/nachfass/logik";

const ERINNERUNG_STATUS = new Set<ErinnerungStatus>(["entwurf", "gesendet", "verworfen", "gestoppt"]);

interface RechnungRoh {
  id: string;
  deal_record_id: string;
  operating_company_id: string | null;
  nummer: string | null;
  status: string;
  brutto_cent: number | string | null;
  rechnungstag: string | null;
  faellig_am: string | null;
  firma_name: string | null;
  verloren: boolean | string | null;
  bewertung_gesperrt: boolean | string | null;
}

export async function ladeKandidaten(ws: string, jetzt: Date): Promise<ErinnerungKandidat[]> {
  const rechnungen = zeilen<RechnungRoh>(
    await db.execute(sql`
      SELECT
        di.id AS id,
        di.deal_record_id AS deal_record_id,
        di.operating_company_id AS operating_company_id,
        di.nummer AS nummer,
        di.status AS status,
        di.brutto_cent AS brutto_cent,
        di.rechnungstag::text AS rechnungstag,
        di.faellig_am::text AS faellig_am,
        (
          SELECT rv.text_value
          FROM record_values rv
          INNER JOIN attributes a ON a.id = rv.attribute_id AND a.slug = 'name'
          WHERE rv.record_id = di.operating_company_id
          LIMIT 1
        ) AS firma_name,
        EXISTS (
          SELECT 1
          FROM record_values sv
          INNER JOIN attributes sa ON sa.id = sv.attribute_id AND sa.slug = 'stage'
          INNER JOIN statuses st ON st.id = sv.text_value
          WHERE sv.record_id = di.deal_record_id
            AND st.stage_category = 'lost'
        ) AS verloren,
        (
          EXISTS (
            SELECT 1
            FROM review_events re
            WHERE re.workspace_id = ${ws}
              AND re.deal_record_id = di.deal_record_id
              AND re.event_type = 'complaint_routed'
          )
          OR EXISTS (
            SELECT 1
            FROM record_values rv
            INNER JOIN attributes a ON a.id = rv.attribute_id AND a.slug = 'review_request_status'
            INNER JOIN statuses st ON st.id = rv.text_value AND st.title = 'complaint_routed'
            WHERE rv.record_id = di.deal_record_id
          )
        ) AS bewertung_gesperrt
      FROM deal_invoices di
      INNER JOIN records r ON r.id = di.deal_record_id AND r.deleted_at IS NULL
      INNER JOIN objects o ON o.id = r.object_id AND o.workspace_id = ${ws} AND o.slug = 'deals'
      INNER JOIN company_settings cs
        ON cs.operating_company_record_id = di.operating_company_id
       AND cs.workspace_id = ${ws}
       AND cs.erinnerung_modus = 'entwurf'
      WHERE di.workspace_id = ${ws}
        AND di.status = 'gestellt'
        AND di.brutto_cent IS NOT NULL
        AND di.faellig_am IS NOT NULL
    `)
  );
  if (rechnungen.length === 0) return [];

  const dealIds = [...new Set(rechnungen.map((r) => r.deal_record_id))];
  const invoiceIds = rechnungen.map((r) => r.id);
  const [zahlungsZeilen, erinnerungen, ereignisse, gespraeche, nachrichten] = await Promise.all([
    db
      .select({
        dealRecordId: payments.dealRecordId,
        amount: payments.amount,
        taxTreatment: payments.taxTreatment,
      })
      .from(payments)
      .where(and(eq(payments.workspaceId, ws), inArray(payments.dealRecordId, dealIds))),
    db
      .select({
        invoiceId: paymentReminders.invoiceId,
        stufe: paymentReminders.stufe,
        status: paymentReminders.status,
        gesendetAm: paymentReminders.gesendetAm,
        createdAt: paymentReminders.createdAt,
      })
      .from(paymentReminders)
      .where(and(eq(paymentReminders.workspaceId, ws), inArray(paymentReminders.invoiceId, invoiceIds))),
    db
      .select({
        id: activityEvents.id,
        recordId: activityEvents.recordId,
        eventType: activityEvents.eventType,
        payload: activityEvents.payload,
        createdAt: activityEvents.createdAt,
      })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.workspaceId, ws),
          inArray(activityEvents.recordId, dealIds),
          inArray(activityEvents.eventType, [...MELDUNG_EREIGNISTYPEN])
        )
      ),
    db
      .select({
        id: inboxConversations.id,
        dealRecordId: inboxConversations.dealRecordId,
        channelAccountId: inboxConversations.channelAccountId,
        channelType: channelAccounts.channelType,
        lastMessageAt: inboxConversations.lastMessageAt,
      })
      .from(inboxConversations)
      .innerJoin(channelAccounts, eq(channelAccounts.id, inboxConversations.channelAccountId))
      .where(and(eq(inboxConversations.workspaceId, ws), inArray(inboxConversations.dealRecordId, dealIds))),
    db
      .select({
        conversationId: inboxMessages.conversationId,
        dealRecordId: inboxConversations.dealRecordId,
        body: inboxMessages.body,
        sentAt: inboxMessages.sentAt,
        createdAt: inboxMessages.createdAt,
      })
      .from(inboxMessages)
      .innerJoin(inboxConversations, eq(inboxConversations.id, inboxMessages.conversationId))
      .where(
        and(
          eq(inboxMessages.workspaceId, ws),
          eq(inboxConversations.workspaceId, ws),
          eq(inboxMessages.direction, "inbound"),
          inArray(inboxConversations.dealRecordId, dealIds)
        )
      ),
  ]);

  const zahlungenJeDeal = gruppe(
    zahlungsZeilen.filter((z) => z.dealRecordId),
    (z) => z.dealRecordId as string
  );
  const erinnerungJeRechnung = gruppe(erinnerungen, (e) => e.invoiceId);
  const ereignisJeDeal = gruppe(
    ereignisse.filter((e) => e.recordId),
    (e) => e.recordId as string
  );
  const gespraechJeDeal = gruppe(
    gespraeche.filter((g) => g.dealRecordId),
    (g) => g.dealRecordId as string
  );
  const nachrichtJeDeal = gruppe(
    nachrichten
      .filter((m) => m.dealRecordId)
      .map((m) => ({
        conversationId: m.conversationId,
        dealRecordId: m.dealRecordId,
        body: m.body,
        am: m.sentAt ?? m.createdAt,
      })),
    (m) => m.dealRecordId as string
  );

  const heute = berlinTag(jetzt);
  const regeln = new Map<string, FirmenZahlungsregel>();
  const portale = new Map<string, { token: string | null; name: string | null; signatur: string | null }>();
  const kandidaten: ErinnerungKandidat[] = [];

  for (const rechnung of rechnungen) {
    const dealId = rechnung.deal_record_id;
    const firmaName = (rechnung.firma_name ?? "").trim();
    const firma = firmaName.toLowerCase().includes("ceylan") ? "ceylan" : "kottke";
    const anrede = firma === "ceylan" ? "sie" : "du";
    const bruttoCent = ganzzahl(rechnung.brutto_cent);
    const rechnungstag = tag(rechnung.rechnungstag);
    const faelligAm = tag(rechnung.faellig_am);
    const status = rechnung.status as RechnungStatus;
    const zahlungen = (zahlungenJeDeal.get(dealId) ?? []).map((z) => ({
      amount: z.amount,
      taxTreatment: z.taxTreatment,
    }));
    const restCent = offenAus({
      rechnung: { status, bruttoCent },
      annahmeCent: null,
      festpreis: null,
      istStunden: false,
      zahlungen,
    }).restCent;

    const nachrichtenDeal = nachrichtJeDeal.get(dealId) ?? [];
    const letzteKunde = spaeteste(nachrichtenDeal.map((m) => m.am));
    const seitRechnung = nachrichtenDeal.filter((m) => {
      if (!m.am) return false;
      if (!rechnungstag) return true;
      return berlinTag(m.am) >= rechnungstag;
    });

    const convs = gespraechJeDeal.get(dealId) ?? [];
    const letzteJeGespraech = new Map<string, Date>();
    for (const m of nachrichtenDeal) {
      if (!m.am) continue;
      const bisher = letzteJeGespraech.get(m.conversationId);
      if (!bisher || m.am.getTime() > bisher.getTime()) letzteJeGespraech.set(m.conversationId, m.am);
    }
    const whatsapps = convs.filter((c) => c.channelType === "whatsapp");
    const mails = convs.filter((c) => c.channelType === "email");
    const wa = neuestesGespraech(whatsapps, letzteJeGespraech);
    const mail = neuestesGespraech(mails, letzteJeGespraech);
    const waEingang = wa ? letzteJeGespraech.get(wa.id) ?? null : null;

    const portal = await portalFuer(ws, dealId, firmaName || null, portale);
    let kanal = erinnerungKanal({
      whatsapp: wa
        ? { istCeylanKonto: istCeylanWhatsApp(wa.channelAccountId), letzteEingehendeAm: waEingang ? waEingang.toISOString() : null }
        : null,
      emailGespraech: mails.length > 0,
      jetzt,
    });
    if (!portal.token) kanal = null;

    const ocId = rechnung.operating_company_id;
    const regel = await regelFuer(ws, ocId, regeln);
    const bisher = (erinnerungJeRechnung.get(rechnung.id) ?? [])
      .map((e) => standAus(e))
      .filter((e): e is ErinnerungStand => e != null);
    const offene = offeneMeldungen(ereignisJeDeal.get(dealId) ?? []);
    const kundeName = portal.name;
    const eingabe: ErinnerungEingabe = {
      regel,
      heute,
      rechnung: { status, bruttoCent, faelligAm },
      restCent,
      bisher,
      offeneMeldung: offene.length > 0,
      letzteKundennachrichtAm: letzteKunde ? letzteKunde.toISOString() : null,
      sperre: sperreAusText(seitRechnung.map((m) => m.body ?? "").join("\n")),
      bewertungGesperrt: wahr(rechnung.bewertung_gesperrt),
      verloren: wahr(rechnung.verloren),
      kanal,
    };

    kandidaten.push({
      workspaceId: ws,
      dealRecordId: dealId,
      invoiceId: rechnung.id,
      operatingCompanyId: ocId,
      firma,
      eingabe,
      text: {
        anrede,
        name: anrede === "du" ? vornameFuerAnrede(kundeName) : kundeName,
        nummer: rechnung.nummer,
        rechnungstag,
        betragCent: restCent ?? 0,
        faelligAm: faelligAm ?? "",
        portalLink: portal.token ? portalUrl(portal.token) : "",
        signatur: portal.signatur ?? firmaName,
      },
      conversationId: kanal === "whatsapp" ? wa?.id ?? null : kanal === "email" ? mail?.id ?? null : null,
    });
  }

  return kandidaten;
}

function portalUrl(token: string): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  return `${envUrl ?? "https://openclaw-crm-web.vercel.app"}/s/${token}`;
}

async function portalFuer(
  ws: string,
  dealId: string,
  firmaName: string | null,
  cache: Map<string, { token: string | null; name: string | null; signatur: string | null }>
): Promise<{ token: string | null; name: string | null; signatur: string | null }> {
  const da = cache.get(dealId);
  if (da) return da;
  const link = await ensureCustomerStatusLink({ workspaceId: ws, dealRecordId: dealId, createdBy: null });
  let name: string | null = null;
  let signatur = firmaName;
  if (link.token) {
    const ctx = await loadContextByToken(link.token);
    name = ctx?.customerDisplayName?.trim() || null;
    const marke = ctx?.branding.displayName?.trim();
    if (marke) signatur = marke;
  }
  const wert = { token: link.token, name, signatur };
  cache.set(dealId, wert);
  return wert;
}

async function regelFuer(
  ws: string,
  ocId: string | null,
  cache: Map<string, FirmenZahlungsregel>
): Promise<FirmenZahlungsregel> {
  const key = ocId ?? "";
  const da = cache.get(key);
  if (da) return da;
  const regel = await ladeZahlungsregel(ws, ocId);
  cache.set(key, regel);
  return regel;
}

function standAus(e: {
  stufe: number;
  status: string;
  gesendetAm: Date | null;
  createdAt: Date;
}): ErinnerungStand | null {
  if (e.stufe !== 1 && e.stufe !== 2) return null;
  if (!ERINNERUNG_STATUS.has(e.status as ErinnerungStatus)) return null;
  const am = e.status === "gesendet" && e.gesendetAm ? e.gesendetAm : e.createdAt;
  return { stufe: e.stufe, status: e.status as ErinnerungStatus, am: am.toISOString() };
}

function neuestesGespraech<T extends { id: string; lastMessageAt: Date | null }>(
  liste: T[],
  letzteEingehende: Map<string, Date>
): T | null {
  if (liste.length === 0) return null;
  return [...liste].sort((a, b) => zeit(b, letzteEingehende) - zeit(a, letzteEingehende))[0] ?? null;
}

function zeit(c: { id: string; lastMessageAt: Date | null }, letzteEingehende: Map<string, Date>): number {
  return Math.max(c.lastMessageAt?.getTime() ?? 0, letzteEingehende.get(c.id)?.getTime() ?? 0);
}

function spaeteste(daten: (Date | null)[]): Date | null {
  let beste: Date | null = null;
  for (const d of daten) {
    if (!d) continue;
    if (!beste || d.getTime() > beste.getTime()) beste = d;
  }
  return beste;
}

function gruppe<T>(zeilenListe: T[], key: (z: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const z of zeilenListe) {
    const k = key(z);
    const liste = map.get(k);
    if (liste) liste.push(z);
    else map.set(k, [z]);
  }
  return map;
}

function zeilen<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const wrapped = result as { rows?: T[] };
  return wrapped.rows ?? [];
}

function ganzzahl(v: number | string | null): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function tag(v: string | null): string | null {
  if (!v) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  return m ? m[1] : null;
}

function wahr(v: boolean | string | null): boolean {
  return v === true || v === "t" || v === "true";
}

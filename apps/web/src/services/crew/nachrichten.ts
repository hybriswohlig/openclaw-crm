/**
 * WhatsApp an die Crew vom Rümpeltürken-Konto (Inhaber 18.11.):
 *
 * 1. Zusage: nach „Team bestätigen“ bekommt jede neu eingeteilte Person einmal
 *    „Du bist dabei“ mit ihrem Link (ausgelöst durch den Klick, nie gesammelt).
 * 2. Neue Jobs: höchstens eine Sammelnachricht pro Person und Tag (Abend), nur
 *    mit Jobs, die sie noch nicht beantwortet hat und die ihr noch nie
 *    angekündigt wurden. Zwischen den Personen eine Pause, damit die verknüpfte
 *    Nummer nicht wie ein Massenversender aussieht.
 *
 * Jeder Versuch steht in `crew_notifications`. Ein Fehler bei einer Person hält
 * die anderen nicht auf. Abschalten je Workspace: `crew_neue_jobs` = `aus`.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { dealEmployees } from "@/db/schema";
import { crewJobAnnouncements, crewNotifications, type CrewNachrichtStatus } from "@/db/schema/crew";
import { berlinDateString } from "@/lib/berlin-date";
import { istCrewLocale } from "@/lib/crew/telefon";
import { neueJobsNachricht, zusageNachricht, type JobZeile } from "@/lib/crew/crew-nachrichten";
import { zeilen } from "@/lib/db-werte";
import { dealTerminLesen } from "@/services/einsatz";
import { sendBaileysDirektText } from "@/services/inbox-whatsapp";
import { getSetting } from "@/services/workspace-settings";
import type { CrewKontext } from "./auth";
import { ladeCrewJobs } from "./jobs";
import { absenderKonto, type SendenDeps } from "./link-senden";
import { crewLinkSicherstellen } from "./links";

export const NEUE_JOBS_SCHALTER = "crew_neue_jobs";

export interface NachrichtenDeps extends SendenDeps {
  /** Pause zwischen zwei Personen (Tests: sofort). */
  pause: (ms: number) => Promise<void>;
}

const standard: NachrichtenDeps = {
  absender: absenderKonto,
  senden: sendBaileysDirektText,
  pause: (ms) => new Promise((r) => setTimeout(r, ms)),
};

interface Person {
  id: string;
  name: string;
  locale: string;
  telefon: string | null;
  active: boolean;
  canDriveSprinter: boolean;
  rateWorkCents: number;
  rateDriveCents: number;
  linkId: string | null;
}

async function personenLesen(ws: string, ids?: string[]): Promise<Person[]> {
  return zeilen<{
    id: string;
    name: string;
    locale: string;
    telefon: string | null;
    active: boolean;
    sprinter: boolean;
    work: number;
    drive: number;
    link_id: string | null;
  }>(
    await db.execute(sql`
      SELECT e.id, e.name, e.locale, e.phone_canonical AS telefon, e.active, e.can_drive_sprinter AS sprinter,
        e.rate_work_cents AS work, e.rate_drive_cents AS drive,
        (SELECT l.id FROM crew_links l WHERE l.employee_id = e.id AND l.workspace_id = e.workspace_id AND l.revoked_at IS NULL) AS link_id
      FROM employees e
      WHERE e.workspace_id = ${ws} ${ids ? sql`AND e.id = ANY(${sql.param(ids)}::text[])` : sql``}
      ORDER BY e.id
    `),
  ).map((z) => ({
    id: z.id,
    name: z.name,
    locale: z.locale,
    telefon: z.telefon,
    active: z.active,
    canDriveSprinter: z.sprinter,
    rateWorkCents: Number(z.work),
    rateDriveCents: Number(z.drive),
    linkId: z.link_id,
  }));
}

function kontextAus(ws: string, p: Person, linkId: string): CrewKontext {
  return {
    workspaceId: ws,
    linkId,
    employee: {
      id: p.id,
      name: p.name?.trim() || "Team",
      locale: istCrewLocale(p.locale) ? p.locale : "de",
      canDriveSprinter: p.canDriveSprinter,
      rateWorkCents: p.rateWorkCents,
      rateDriveCents: p.rateDriveCents,
    },
  };
}

async function vermerken(ws: string, deal: string | null, person: string, kind: "zusage" | "neue_jobs", s: { status: CrewNachrichtStatus; fehler?: string }, autor: string | null) {
  // Sammelnachricht hängt an keinem Deal: dann am ersten angekündigten Job vermerkt (der Aufrufer reicht ihn).
  if (!deal) return;
  await db
    .insert(crewNotifications)
    .values({ workspaceId: ws, dealRecordId: deal, employeeId: person, kind, status: s.status, error: s.fehler ?? null, createdBy: autor })
    .catch((err) => console.error("[crew-nachrichten] nicht vermerkt:", err instanceof Error ? err.message : String(err)));
}

/** Link sicherstellen und senden; nie werfen. */
async function anPerson(
  ws: string,
  p: Person,
  konto: string | null,
  text: (url: string) => string,
  autor: string,
  deps: NachrichtenDeps,
): Promise<{ status: CrewNachrichtStatus; fehler?: string }> {
  try {
    if (!p.telefon) return { status: "kein_telefon" };
    if (!p.active) return { status: "kein_link" };
    if (!konto) return { status: "kein_absender" };
    const l = await crewLinkSicherstellen(ws, p.id, autor);
    if (!l.ok || !l.link || !l.link.aktiv) return { status: "kein_link" };
    await deps.senden({ accountId: konto, peerWaId: p.telefon.replace(/\D/g, ""), text: text(l.link.url) });
    return { status: "gesendet" };
  } catch (err) {
    const fehler = err instanceof Error ? err.message : String(err);
    console.error("[crew-nachrichten] Versand fehlgeschlagen:", fehler);
    return { status: "fehler", fehler: fehler.slice(0, 500) };
  }
}

/** Wer gerade im Team des Deals ist (vor „Team bestätigen“ gelesen, um die Neuen zu finden). */
export async function teamIdsLesen(deal: string): Promise<string[]> {
  const rows = await db.select({ id: dealEmployees.employeeId }).from(dealEmployees).where(eq(dealEmployees.dealRecordId, deal));
  return rows.map((z) => z.id);
}

export interface ZusageErgebnis {
  gesendet: number;
  gesamt: number;
}

/** „Du bist dabei“ an die neu eingeteilten Personen eines Deals. Wirft nie. */
export async function zusageSenden(ws: string, deal: string, neu: string[], autor: string, deps: NachrichtenDeps = standard): Promise<ZusageErgebnis> {
  if (neu.length === 0) return { gesendet: 0, gesamt: 0 };
  let gesendet = 0;
  try {
    const konto = await deps.absender(ws).catch(() => null);
    const personen = await personenLesen(ws, neu);
    const tag = (await dealTerminLesen(ws, deal).catch(() => null)) ?? "";
    for (const [i, p] of personen.entries()) {
      if (i > 0) await deps.pause(700);
      // Job so, wie die Person ihn sieht (Tag, Art, Ort); ohne Link nur mit Tag.
      let job: JobZeile | null = null;
      if (p.linkId) {
        const [j] = await ladeCrewJobs(kontextAus(ws, p, p.linkId), { dealIds: [deal] }).catch(() => []);
        if (j) job = { date: j.date, type: j.type, town: j.town, fix: j.fix };
      }
      const s = await anPerson(ws, p, konto, (url) => zusageNachricht(istCrewLocale(p.locale) ? p.locale : "de", p.name, job ?? { date: tag, type: "other", town: "", fix: true }, url), autor, deps);
      if (s.status === "gesendet") gesendet++;
      await vermerken(ws, deal, p.id, "zusage", s, autor);
    }
  } catch (err) {
    console.error("[crew-nachrichten] Zusage:", err instanceof Error ? err.message : String(err));
  }
  return { gesendet, gesamt: neu.length };
}

export interface RundschreibenErgebnis {
  workspaces: number;
  gesendet: number;
  ohneNeues: number;
  uebersprungen: number;
  fehler: number;
  /** Zeitgrenze erreicht, Rest morgen. */
  abgebrochen: boolean;
}

export const LAUF_SCHLUESSEL = "crew_neue_jobs_lauf";

/**
 * Beansprucht den heutigen Lauf für diesen Workspace in einem Schritt. Nur ein
 * Aufruf pro Berliner Tag bekommt true; ein doppelt ausgelöster Cron sendet nie zweimal.
 */
export async function laufBeanspruchen(ws: string, heute: string): Promise<boolean> {
  const r = zeilen<{ ok: number }>(
    await db.execute(sql`
      INSERT INTO workspace_settings (workspace_id, key, value_plain, is_secret, updated_at)
      VALUES (${ws}, ${LAUF_SCHLUESSEL}, ${heute}, false, now())
      ON CONFLICT (workspace_id, key) DO UPDATE SET value_plain = EXCLUDED.value_plain, updated_at = now()
        WHERE workspace_settings.value_plain IS DISTINCT FROM EXCLUDED.value_plain
      RETURNING 1 AS ok
    `),
  );
  return r.length > 0;
}

/**
 * Sammelnachricht zu neuen Jobs, für alle Workspaces mit Crew-Links. Pro Person
 * höchstens eine am Tag (Berlin); nur Jobs ab morgen, noch offen und nicht voll.
 */
export async function neueJobsRundschreiben(
  o: { jetzt?: Date; deps?: NachrichtenDeps; budgetMs?: number; uhr?: () => number } = {},
): Promise<RundschreibenErgebnis> {
  const jetzt = o.jetzt ?? new Date();
  const deps = o.deps ?? standard;
  const uhr = o.uhr ?? Date.now;
  const start = uhr();
  // Vercel bricht nach 300 s ab: rechtzeitig aufhören. Wer heute nicht mehr drankommt, bekommt die Jobs morgen.
  const budget = o.budgetMs ?? 240_000;
  const heute = berlinDateString(jetzt);
  const erg: RundschreibenErgebnis = { workspaces: 0, gesendet: 0, ohneNeues: 0, uebersprungen: 0, fehler: 0, abgebrochen: false };
  const wss = zeilen<{ ws: string }>(await db.execute(sql`SELECT DISTINCT workspace_id AS ws FROM crew_links WHERE revoked_at IS NULL ORDER BY 1`));
  for (const { ws } of wss) {
    if ((await getSetting(ws, NEUE_JOBS_SCHALTER).catch(() => null)) === "aus") continue;
    erg.workspaces++;
    const konto = await deps.absender(ws).catch(() => null);
    if (!konto) {
      erg.uebersprungen++;
      continue;
    }
    if (!(await laufBeanspruchen(ws, heute))) {
      erg.uebersprungen++;
      continue;
    }
    // Heute (Berlin) schon eine Sammelnachricht bekommen? Dann nicht noch eine.
    const heuteSchon = new Set(
      zeilen<{ id: string }>(
        await db.execute(sql`
          SELECT DISTINCT employee_id AS id FROM crew_notifications
          WHERE workspace_id = ${ws} AND kind = 'neue_jobs' AND status = 'gesendet'
            AND (created_at AT TIME ZONE 'Europe/Berlin')::date = ${heute}::date
        `),
      ).map((z) => z.id),
    );
    const personen = (await personenLesen(ws)).filter((p) => p.active && p.telefon && p.linkId && !heuteSchon.has(p.id));
    let erste = true;
    for (const p of personen) {
      if (uhr() - start > budget) {
        erg.abgebrochen = true;
        console.warn("[crew-nachrichten] Zeitgrenze erreicht, Rest morgen");
        break;
      }
      try {
        const k = kontextAus(ws, p, p.linkId!);
        const offen = (await ladeCrewJobs(k, { jetzt })).filter((j) => j.my.status === "offen" && !j.full && j.date > heute);
        if (offen.length === 0) {
          erg.ohneNeues++;
          continue;
        }
        const schon = new Set(
          (
            await db
              .select({ deal: crewJobAnnouncements.dealRecordId })
              .from(crewJobAnnouncements)
              .where(and(eq(crewJobAnnouncements.employeeId, p.id), inArray(crewJobAnnouncements.dealRecordId, offen.map((j) => j.id))))
          ).map((z) => z.deal),
        );
        const neu = offen.filter((j) => !schon.has(j.id));
        if (neu.length === 0) {
          erg.ohneNeues++;
          continue;
        }
        if (!erste) await deps.pause(2000 + Math.floor(Math.random() * 3000));
        erste = false;
        const locale = istCrewLocale(p.locale) ? p.locale : "de";
        const s = await anPerson(ws, p, konto, (url) => neueJobsNachricht(locale, p.name, neu.map((j) => ({ date: j.date, type: j.type, town: j.town, fix: j.fix })), url), "system", deps);
        await vermerken(ws, neu[0]!.id, p.id, "neue_jobs", s, "system");
        if (s.status === "gesendet") {
          erg.gesendet++;
          await db
            .insert(crewJobAnnouncements)
            .values(neu.map((j) => ({ workspaceId: ws, dealRecordId: j.id, employeeId: p.id })))
            .onConflictDoNothing();
        } else erg.fehler++;
      } catch (err) {
        erg.fehler++;
        console.error("[crew-nachrichten] Rundschreiben:", err instanceof Error ? err.message : String(err));
      }
    }
  }
  return erg;
}

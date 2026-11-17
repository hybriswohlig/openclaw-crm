/**
 * Einsatzbriefing (Crew-Portal Phase 2). Das Team sieht es erst, wenn wir es im
 * Einsatz-Dialog freigegeben haben („Briefing freigeben“), und nur, wer in
 * `deal_employees` eingeteilt ist. Inhalt deterministisch aus Auftrag und Deal.
 *
 * Nie im Briefing: Preise, Positionen, interne Notizen (`notes`), die Büro-
 * Checkliste. Die Barzahlung sieht nur der Teamleiter (ohne Teamleiter alle).
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { crewBriefingReads, crewBriefings } from "@/db/schema/crew";
import type { CrewBriefing, CrewBriefingMember, CrewBriefingStop } from "@/lib/crew/contract";
import { farbeAus, initialenAus, vornameAus } from "@/lib/crew/logik";
import { alsJson, zeilen } from "@/lib/db-werte";
import type { CrewKontext } from "./auth";
import { auftragVon } from "./ausschreibung";
import { adresseText, janein, ladeCrewJobs, ortAus, werteAus, werteJson, zahl, type Wert, type Werte } from "./jobs";

const AUFTRAG_SLUGS = [
  "transporter",
  "depot",
  "boxes_needed",
  "contact_pickup_name",
  "contact_pickup_phone",
  "contact_dropoff_name",
  "contact_dropoff_phone",
  "payment_method",
  "amount_outstanding",
  "special_requests",
  "stairwell_from",
  "stairwell_to",
  "walking_distance_from_m",
  "walking_distance_to_m",
  "parking_halteverbot_needed",
  "parking_halteverbot_to",
] as const;
const DEAL_SLUGS = ["move_from_address", "move_to_address", "floors_from", "floors_to", "elevator_from", "elevator_to"] as const;

const text = (w: Wert | undefined): string | null => {
  const t = typeof w?.t === "string" ? w.t.trim() : "";
  return t === "" ? null : t;
};
const option = (w: Wert | undefined): string | null => (typeof w?.o === "string" && w.o.trim() !== "" ? w.o.trim() : null);
const ganz = (w: Wert | undefined): number | null => {
  const n = zahl(w);
  return n === null ? null : Math.round(n);
};

/** Betrag eines Währungsfelds (`{ amount, currencyCode }` in Euro) in Cent. */
export function betragCent(w: Wert | undefined): number | null {
  const j = alsJson(w?.j) as { amount?: unknown } | null;
  const roh = j && typeof j === "object" ? j.amount : w?.n;
  const n = typeof roh === "number" ? roh : typeof roh === "string" ? Number(roh) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

/** Zahlungsart aus dem Optionstitel; unbekannt → null (dann zeigen wir nichts). */
export function zahlungsArt(titel: string | null): "bar" | "ueberweisung" | "bezahlt" | null {
  const t = (titel ?? "").trim().toLowerCase();
  if (t === "bar") return "bar";
  if (t.startsWith("überweisung") || t.startsWith("ueberweisung")) return "ueberweisung";
  if (t.startsWith("bereits bezahlt")) return "bezahlt";
  return null;
}

/** Zahlung fürs Briefing: nur für den Teamleiter, oder für alle, wenn es keinen gibt. */
export function zahlungFuer(aw: Werte, ichBinLeiter: boolean, teamHatLeiter: boolean): CrewBriefing["payment"] {
  if (teamHatLeiter && !ichBinLeiter) return null;
  const art = zahlungsArt(option(aw.payment_method));
  if (!art) return null;
  return { kind: art, amountCents: art === "bar" ? betragCent(aw.amount_outstanding) : null };
}

/** Abhol- und Zieladresse; eine Adresse ohne Text fällt weg (Entrümpelung hat oft kein Ziel). */
export function stoppsAus(dw: Werte, aw: Werte): CrewBriefingStop[] {
  const kontakt = (name: string | null, tel: string | null) => (name || tel ? { name, phone: tel } : null);
  const stopps: Array<CrewBriefingStop | null> = [
    stopp("from", dw.move_from_address, {
      floor: ganz(dw.floors_from),
      access: option(dw.elevator_from),
      stairwell: option(aw.stairwell_from),
      walkM: ganz(aw.walking_distance_from_m),
      halteverbot: janein(aw.parking_halteverbot_needed) === true,
      contact: kontakt(text(aw.contact_pickup_name), text(aw.contact_pickup_phone)),
    }),
    stopp("to", dw.move_to_address, {
      floor: ganz(dw.floors_to),
      access: option(dw.elevator_to),
      stairwell: option(aw.stairwell_to),
      walkM: ganz(aw.walking_distance_to_m),
      halteverbot: janein(aw.parking_halteverbot_to) === true,
      contact: kontakt(text(aw.contact_dropoff_name), text(aw.contact_dropoff_phone)),
    }),
  ];
  return stopps.filter((x): x is CrewBriefingStop => x !== null);
}

function stopp(kind: "from" | "to", adresse: Wert | undefined, rest: Omit<CrewBriefingStop, "kind" | "address">): CrewBriefingStop | null {
  const address = adresseText(ortAus(adresse));
  return address ? { kind, address, ...rest } : null;
}

interface TeamZeile {
  id: string;
  role: string;
  name: string | null;
  phone: string | null;
}

export function teamAus(team: TeamZeile[], ich: string): CrewBriefingMember[] {
  return team.map((t) => {
    const name = t.name?.trim() || "?";
    return {
      firstName: vornameAus(name),
      initials: initialenAus(name),
      color: farbeAus(t.id),
      role: t.role === "lead" ? "lead" : "helper",
      phone: t.phone,
      me: t.id === ich,
    };
  });
}

export type BriefingErgebnis = { ok: true; briefing: CrewBriefing } | { ok: false; code: "JOB_NICHT_SICHTBAR" | "BRIEFING_NICHT_FREI" };

interface Roh {
  released_at: string | null;
  read_at: string | null;
  im_team: boolean;
  aw: unknown;
  dw: unknown;
  depot: unknown;
  equipment: unknown;
  team: unknown;
}

export async function briefingLesen(k: CrewKontext, dealId: string): Promise<BriefingErgebnis> {
  const ws = k.workspaceId;
  const ich = k.employee.id;
  const [z] = zeilen<Roh>(
    await db.execute(sql`
      SELECT
        (SELECT to_char(b.released_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM crew_briefings b
         WHERE b.deal_record_id = ${dealId} AND b.workspace_id = ${ws} AND b.withdrawn_at IS NULL) AS released_at,
        (SELECT to_char(r.read_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM crew_briefing_reads r
         INNER JOIN crew_briefings b ON b.deal_record_id = r.deal_record_id AND b.released_at = r.release_at
         WHERE r.deal_record_id = ${dealId} AND r.employee_id = ${ich}) AS read_at,
        EXISTS (SELECT 1 FROM deal_employees de WHERE de.deal_record_id = ${dealId} AND de.employee_id = ${ich}) AS im_team,
        ${werteJson(ws, sql`au.id`, "auftraege", AUFTRAG_SLUGS)} AS aw,
        ${werteJson(ws, sql`${dealId}`, "deals", DEAL_SLUGS)} AS dw,
        (SELECT ${werteJson(ws, sql`dv.referenced_record_id`, "transport_depots", ["name", "address"])}
         FROM record_values dv INNER JOIN attributes da ON da.id = dv.attribute_id AND da.slug = 'depot'
         INNER JOIN objects dob ON dob.id = da.object_id AND dob.slug = 'auftraege' AND dob.workspace_id = ${ws}
         WHERE dv.record_id = au.id AND dv.referenced_record_id IS NOT NULL
         ORDER BY dv.sort_order, dv.id LIMIT 1) AS depot,
        (SELECT jsonb_agg(so.title ORDER BY v.sort_order, v.id) FROM record_values v
         INNER JOIN attributes a ON a.id = v.attribute_id AND a.slug = 'equipment_needed'
         INNER JOIN objects ob ON ob.id = a.object_id AND ob.slug = 'auftraege' AND ob.workspace_id = ${ws}
         INNER JOIN select_options so ON so.id = v.text_value AND so.attribute_id = v.attribute_id
         WHERE v.record_id = au.id) AS equipment,
        (SELECT jsonb_agg(jsonb_build_object('id', de.employee_id, 'role', de.role, 'name', e.name, 'phone', e.phone_canonical)
                ORDER BY (de.role = 'lead') DESC, de.created_at, de.id)
         FROM deal_employees de INNER JOIN employees e ON e.id = de.employee_id AND e.workspace_id = ${ws}
         WHERE de.deal_record_id = ${dealId}) AS team
      FROM (SELECT 1) eins
      LEFT JOIN LATERAL (${auftragVon(ws, dealId)}) au ON true
    `),
  );
  if (!z?.im_team) return { ok: false, code: "JOB_NICHT_SICHTBAR" };
  if (!z.released_at) return { ok: false, code: "BRIEFING_NICHT_FREI" };

  const [job] = await ladeCrewJobs(k, { dealIds: [dealId] });
  if (!job) return { ok: false, code: "JOB_NICHT_SICHTBAR" };

  const aw = werteAus(z.aw);
  const dw = werteAus(z.dw);
  const dep = werteAus(z.depot);
  const teamRoh = (alsJson(z.team) as TeamZeile[] | null) ?? [];
  const team = teamAus(teamRoh, ich);
  const ichLeiter = teamRoh.some((t) => t.id === ich && t.role === "lead");
  const depotName = text(dep.name);
  const kartons = ganz(aw.boxes_needed);

  return {
    ok: true,
    briefing: {
      job,
      releasedAt: z.released_at,
      readAt: z.read_at,
      stops: stoppsAus(dw, aw),
      team,
      vehicle: option(aw.transporter),
      vehiclePickup: depotName ? { name: depotName, address: adresseText(ortAus(dep.address)) } : null,
      equipment: ((alsJson(z.equipment) as string[] | null) ?? []).filter((x) => typeof x === "string" && x.trim() !== ""),
      boxes: kartons !== null && kartons > 0 ? kartons : null,
      wishes: text(aw.special_requests),
      payment: zahlungFuer(aw, ichLeiter, teamRoh.some((t) => t.role === "lead")),
    },
  };
}

/** „Gelesen ✓“ zur aktuellen Freigabe, nur wenn `gesehen` genau sie ist. Mehrfach tippen ändert nichts. */
export async function briefingGelesen(
  k: CrewKontext,
  dealId: string,
  gesehen: string,
): Promise<{ ok: true; readAt: string } | { ok: false; code: "JOB_NICHT_SICHTBAR" | "BRIEFING_NICHT_FREI" | "BRIEFING_VERALTET" }> {
  const ws = k.workspaceId;
  const ich = k.employee.id;
  const [b] = await db
    .select({ releasedAt: crewBriefings.releasedAt, withdrawnAt: crewBriefings.withdrawnAt })
    .from(crewBriefings)
    .where(and(eq(crewBriefings.dealRecordId, dealId), eq(crewBriefings.workspaceId, ws)))
    .limit(1);
  const [imTeam] = zeilen<{ ja: boolean }>(
    await db.execute(sql`SELECT EXISTS (SELECT 1 FROM deal_employees WHERE deal_record_id = ${dealId} AND employee_id = ${ich}) AS ja`),
  );
  if (!imTeam?.ja) return { ok: false, code: "JOB_NICHT_SICHTBAR" };
  if (!b || b.withdrawnAt) return { ok: false, code: "BRIEFING_NICHT_FREI" };
  // Gelesen gilt nur für die Fassung, die die Person vor sich hatte.
  if (Date.parse(gesehen) !== b.releasedAt.getTime()) return { ok: false, code: "BRIEFING_VERALTET" };
  await db
    .insert(crewBriefingReads)
    .values({ workspaceId: ws, dealRecordId: dealId, employeeId: ich, releaseAt: b.releasedAt })
    .onConflictDoNothing();
  const [r] = await db
    .select({ readAt: crewBriefingReads.readAt })
    .from(crewBriefingReads)
    .where(and(eq(crewBriefingReads.dealRecordId, dealId), eq(crewBriefingReads.employeeId, ich), eq(crewBriefingReads.releaseAt, b.releasedAt)))
    .limit(1);
  return { ok: true, readAt: (r?.readAt ?? new Date()).toISOString() };
}

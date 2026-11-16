/**
 * Persönlicher Crew-Link je Mitarbeiter (Lebenszyklus wie customer_status_links):
 * anlegen, erneuern (alter Token sofort tot), sperren, lesen. Nur für die
 * Inhaber-Oberfläche; die Crew-API löst den Token in `./auth.ts` auf.
 */
import { and, eq, sql } from "drizzle-orm";
import { generateToken } from "@openclaw-crm/customer-portal-core";
import { db } from "@/db";
import { crewLinks, employees } from "@/db/schema";

export interface CrewLinkAnsicht {
  url: string;
  createdAt: string;
  revokedAt: string | null;
  lastSeenAt: string | null;
  viewCount: number;
  aktiv: boolean;
}

/** Basis des Portals aus `CREW_PORTAL_URL`, sonst die lokale Entwicklung. */
export function crewPortalBasis(env: string | undefined = process.env.CREW_PORTAL_URL): string {
  const basis = env?.trim() || "http://localhost:3100";
  return basis.replace(/\/+$/, "");
}

export function crewLinkUrl(token: string, basis: string = crewPortalBasis()): string {
  return `${basis}/l/${token}`;
}

type Zeile = typeof crewLinks.$inferSelect;

function ansichtAus(z: Zeile): CrewLinkAnsicht {
  return {
    url: crewLinkUrl(z.token),
    createdAt: z.createdAt.toISOString(),
    revokedAt: z.revokedAt ? z.revokedAt.toISOString() : null,
    lastSeenAt: z.lastSeenAt ? z.lastSeenAt.toISOString() : null,
    viewCount: z.viewCount,
    aktiv: z.revokedAt === null,
  };
}

async function personImWorkspace(ws: string, employeeId: string): Promise<{ active: boolean } | null> {
  const [p] = await db
    .select({ active: employees.active })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.workspaceId, ws)))
    .limit(1);
  return p ?? null;
}

async function zeileLesen(ws: string, employeeId: string): Promise<Zeile | null> {
  const [z] = await db
    .select()
    .from(crewLinks)
    .where(and(eq(crewLinks.workspaceId, ws), eq(crewLinks.employeeId, employeeId)))
    .limit(1);
  return z ?? null;
}

export type LinkErgebnis =
  | { ok: true; link: CrewLinkAnsicht | null; neu?: boolean }
  | { ok: false; code: "NICHT_GEFUNDEN" | "INAKTIV" };

/** Link der Person (auch gesperrt), null ohne Link. */
export async function crewLinkLesen(ws: string, employeeId: string): Promise<LinkErgebnis> {
  if (!(await personImWorkspace(ws, employeeId))) return { ok: false, code: "NICHT_GEFUNDEN" };
  const z = await zeileLesen(ws, employeeId);
  return { ok: true, link: z ? ansichtAus(z) : null };
}

/**
 * Link anlegen, idempotent: ein bestehender aktiver Link bleibt (gleicher
 * Token). Ein gesperrter Link bekommt einen neuen Token, damit ein einmal
 * gesperrter Token nie wieder gilt. Nur für aktive Personen.
 */
export async function crewLinkAnlegen(ws: string, employeeId: string, autor: string): Promise<LinkErgebnis> {
  const p = await personImWorkspace(ws, employeeId);
  if (!p) return { ok: false, code: "NICHT_GEFUNDEN" };
  if (!p.active) return { ok: false, code: "INAKTIV" };
  const da = await zeileLesen(ws, employeeId);
  if (da && da.revokedAt === null) return { ok: true, link: ansichtAus(da), neu: false };
  if (da) return crewLinkErneuern(ws, employeeId);
  const token = await generateToken();
  const [z] = await db
    .insert(crewLinks)
    .values({ workspaceId: ws, employeeId, token, createdBy: autor })
    .onConflictDoNothing({ target: crewLinks.employeeId })
    .returning();
  // Paralleles Anlegen: der andere Aufruf hat gewonnen, sein Link gilt.
  const zeile = z ?? (await zeileLesen(ws, employeeId));
  return zeile ? { ok: true, link: ansichtAus(zeile), neu: !!z } : { ok: false, code: "NICHT_GEFUNDEN" };
}

/** Neuer Token auf derselben Zeile, Sperre aufgehoben, Zähler bleiben. */
export async function crewLinkErneuern(ws: string, employeeId: string): Promise<LinkErgebnis> {
  const p = await personImWorkspace(ws, employeeId);
  if (!p) return { ok: false, code: "NICHT_GEFUNDEN" };
  if (!p.active) return { ok: false, code: "INAKTIV" };
  const token = await generateToken();
  const [z] = await db
    .update(crewLinks)
    .set({ token, revokedAt: null })
    .where(and(eq(crewLinks.workspaceId, ws), eq(crewLinks.employeeId, employeeId)))
    .returning();
  return z ? { ok: true, link: ansichtAus(z), neu: true } : { ok: true, link: null };
}

/** Sperren: der Token führt ins Leere, die Zeile bleibt (zuletzt geöffnet bleibt sichtbar). */
export async function crewLinkSperren(ws: string, employeeId: string): Promise<LinkErgebnis> {
  if (!(await personImWorkspace(ws, employeeId))) return { ok: false, code: "NICHT_GEFUNDEN" };
  const [z] = await db
    .update(crewLinks)
    .set({ revokedAt: sql`coalesce(${crewLinks.revokedAt}, now())` })
    .where(and(eq(crewLinks.workspaceId, ws), eq(crewLinks.employeeId, employeeId)))
    .returning();
  return { ok: true, link: z ? ansichtAus(z) : null };
}

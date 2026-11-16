/**
 * Anmeldung der Crew-API (Vertrag „Authentication“): nur Server zu Server.
 * `X-Crew-Secret` gegen `CREW_API_SECRET` in konstanter Zeit, dann
 * `X-Crew-Token` (Form, Link nicht gesperrt, Person aktiv). Falsches
 * Geheimnis → 401 ohne Hinweis auf den Token; alles am Token → 404.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { crewLinks, employees } from "@/db/schema";
import { crewFehler } from "@/lib/crew/antwort";
import { CREW_TOKEN_RE, type CrewLocale } from "@/lib/crew/contract";

/** Mindestlänge des gemeinsamen Geheimnisses (Vertrag: ≥ 32 Bytes). */
export const CREW_SECRET_MIN = 32;
/** `last_seen_at` höchstens einmal je Minute schreiben. */
export const ZULETZT_GESEHEN_TAKT_MS = 60_000;

export interface CrewKontext {
  workspaceId: string;
  linkId: string;
  employee: {
    id: string;
    name: string;
    locale: CrewLocale;
    canDriveSprinter: boolean;
    rateWorkCents: number;
    rateDriveCents: number;
  };
}

const hash = (s: string) => createHash("sha256").update(s, "utf8").digest();

/**
 * Geheimnis in konstanter Zeit prüfen (über SHA-256, damit auch ungleiche
 * Längen gleich lange dauern). Ohne oder mit zu kurzem Geheimnis in der
 * Umgebung ist alles falsch (fail closed).
 */
export function geheimnisPasst(gesendet: string | null, erwartet: string | undefined): boolean {
  if (!erwartet || Buffer.byteLength(erwartet, "utf8") < CREW_SECRET_MIN) return false;
  const passt = timingSafeEqual(hash(gesendet ?? ""), hash(erwartet));
  return passt && gesendet !== null;
}

export type CrewAnmeldung = { ok: true; k: CrewKontext } | { ok: false; antwort: NextResponse };

/** Token zu Kontext; null wenn unbekannt, gesperrt oder Person inaktiv. */
export async function crewLinkAufloesen(token: string): Promise<(CrewKontext & { lastSeenAt: Date | null }) | null> {
  const [z] = await db
    .select({
      linkId: crewLinks.id,
      workspaceId: crewLinks.workspaceId,
      lastSeenAt: crewLinks.lastSeenAt,
      id: employees.id,
      name: employees.name,
      locale: employees.locale,
      canDriveSprinter: employees.canDriveSprinter,
      rateWorkCents: employees.rateWorkCents,
      rateDriveCents: employees.rateDriveCents,
    })
    .from(crewLinks)
    .innerJoin(employees, and(eq(employees.id, crewLinks.employeeId), eq(employees.workspaceId, crewLinks.workspaceId)))
    .where(and(eq(crewLinks.token, token), isNull(crewLinks.revokedAt), eq(employees.active, true)))
    .limit(1);
  if (!z) return null;
  return {
    workspaceId: z.workspaceId,
    linkId: z.linkId,
    lastSeenAt: z.lastSeenAt,
    employee: {
      id: z.id,
      name: z.name?.trim() || "Team",
      locale: z.locale,
      canDriveSprinter: z.canDriveSprinter,
      rateWorkCents: z.rateWorkCents,
      rateDriveCents: z.rateDriveCents,
    },
  };
}

/** Zuletzt gesehen und Zähler, höchstens einmal je Minute (bedingtes Update, kein Doppelzählen). */
export async function zuletztGesehen(linkId: string, lastSeenAt: Date | null, jetzt: Date): Promise<void> {
  if (lastSeenAt && jetzt.getTime() - lastSeenAt.getTime() < ZULETZT_GESEHEN_TAKT_MS) return;
  const grenze = new Date(jetzt.getTime() - ZULETZT_GESEHEN_TAKT_MS);
  await db
    .update(crewLinks)
    .set({ lastSeenAt: jetzt, viewCount: sql`${crewLinks.viewCount} + 1` })
    .where(and(eq(crewLinks.id, linkId), or(isNull(crewLinks.lastSeenAt), lt(crewLinks.lastSeenAt, grenze))));
}

export interface RequireCrewOptionen {
  jetzt?: Date;
  /** Für Tests; sonst `CREW_API_SECRET`. */
  geheimnis?: string;
  /** Für Tests: Token-Auflösung und Zähler ohne Datenbank. */
  aufloesen?: typeof crewLinkAufloesen;
  gesehen?: typeof zuletztGesehen;
}

export async function requireCrew(req: Request, o: RequireCrewOptionen = {}): Promise<CrewAnmeldung> {
  const erwartet = o.geheimnis ?? process.env.CREW_API_SECRET;
  if (!geheimnisPasst(req.headers.get("x-crew-secret"), erwartet)) {
    return { ok: false, antwort: crewFehler("UNAUTHORIZED") };
  }
  const token = req.headers.get("x-crew-token") ?? "";
  if (!CREW_TOKEN_RE.test(token)) return { ok: false, antwort: crewFehler("LINK_UNGUELTIG") };
  const k = await (o.aufloesen ?? crewLinkAufloesen)(token);
  if (!k) return { ok: false, antwort: crewFehler("LINK_UNGUELTIG") };
  const { lastSeenAt, ...kontext } = k;
  try {
    await (o.gesehen ?? zuletztGesehen)(k.linkId, lastSeenAt, o.jetzt ?? new Date());
  } catch (err) {
    // Statistik darf die Anfrage nie scheitern lassen.
    console.error("[crew] zuletzt gesehen", err);
  }
  return { ok: true, k: kontext };
}

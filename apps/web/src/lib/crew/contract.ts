/**
 * Crew API v1 contract (crew-portal <-> openclaw-crm).
 * Keep byte-identical with openclaw-crm `apps/web/src/lib/crew/contract.ts`.
 * Spec and rules: docs/API-CONTRACT.md
 */
import { z } from "zod";

export const CREW_LOCALES = ["de", "en", "tr", "ar", "pl", "uk", "ru"] as const;
export const CrewLocale = z.enum(CREW_LOCALES);
export type CrewLocale = z.infer<typeof CrewLocale>;

export const CREW_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

export const CrewMe = z.object({
  employee: z.object({
    id: z.string(),
    firstName: z.string(),
    initials: z.string().max(3),
    locale: CrewLocale,
    canDriveSprinter: z.boolean(),
    /** Stable avatar colour, hex without '#'. */
    color: z.string().regex(/^[0-9a-f]{6}$/i),
  }),
});
export type CrewMe = z.infer<typeof CrewMe>;

export const CrewMemberRole = z.enum(["lead", "helper"]);
export const CrewMember = z.object({
  firstName: z.string(),
  initials: z.string().max(3),
  role: CrewMemberRole,
  isMe: z.boolean(),
  color: z.string().regex(/^[0-9a-f]{6}$/i),
});
export type CrewMember = z.infer<typeof CrewMember>;

/** Standard task keys the portal can translate; label is always the German original. */
export const CREW_TASK_KEYS = [
  "floor_from", // value: floor number (0 = EG)
  "floor_to",
  "no_lift",
  "lift",
  "volume", // value: m³
  "piano",
  "dismantling",
  "packing",
  "disposal",
  "storage",
  "halteverbot",
  "long_walk", // value: metres
  "clearance_household",
  "clearance_cellar_attic",
  "kitchen_dismantle",
  "kitchen_assemble",
] as const;
export const CrewTask = z.object({
  key: z.enum(CREW_TASK_KEYS).nullable(),
  value: z.number().nullable(),
  label: z.string(),
});
export type CrewTask = z.infer<typeof CrewTask>;

export const CrewMyStatus = z.enum(["offen", "ja", "vielleicht", "nein", "warteliste", "bestaetigt"]);
export type CrewMyStatus = z.infer<typeof CrewMyStatus>;

export const CrewJob = z.object({
  id: z.string(),
  company: z.enum(["kottke", "ruempeltuerken"]),
  type: z.enum(["move", "clearance", "kitchen", "other"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  start: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  end: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  town: z.string(),
  district: z.string().nullable(),
  need: z.number().int().min(1),
  crew: z.array(CrewMember),
  /** Unconfirmed 'ja' requests of other people. */
  openRequests: z.number().int().min(0),
  tasks: z.array(CrewTask),
  sprinterNeeded: z.boolean(),
  note: z.string().nullable(),
  pay: z
    .object({
      workMinutes: z.number().int(),
      driveMinutes: z.number().int(),
      rateWorkCents: z.number().int(),
      rateDriveCents: z.number().int(),
      lowCents: z.number().int(),
      highCents: z.number().int(),
    })
    .nullable(),
  photos: z.array(z.object({ id: z.string(), w: z.number().int().nullable(), h: z.number().int().nullable() })),
  my: z.object({ status: CrewMyStatus, answeredAt: z.string().nullable() }),
  isLead: z.boolean(),
  full: z.boolean(),
  conflictSameDay: z.boolean(),
  /** Only when my.status === 'bestaetigt'. */
  address: z.string().nullable(),
});
export type CrewJob = z.infer<typeof CrewJob>;

export const CrewJobsResponse = z.object({ jobs: z.array(CrewJob), serverTime: z.string() });
export type CrewJobsResponse = z.infer<typeof CrewJobsResponse>;

export const CrewAnswerBody = z.object({ answer: z.enum(["ja", "vielleicht", "nein"]).nullable() });
export type CrewAnswerBody = z.infer<typeof CrewAnswerBody>;

export const CrewError = z.object({
  error: z.enum(["UNAUTHORIZED", "LINK_UNGUELTIG", "JOB_NICHT_SICHTBAR", "BEREITS_BESTAETIGT", "UNGUELTIG"]),
  message: z.string().optional(),
});
export type CrewError = z.infer<typeof CrewError>;

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getAuthContext, unauthorized, badRequest, success } from "@/lib/api-utils";
import { db } from "@/db";
import { objects, attributes, selectOptions } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import { getRecord, updateRecord } from "@/services/records";
import {
  estimateRoundTrip,
  rankDepotsToPickup,
  DriveTimeConfigError,
  DriveTimeAPIError,
  type DepotDistance,
} from "@/services/drive-time";
import {
  estimateLoadUnloadMinutes,
  pickDepot,
  type DepotCandidate,
} from "@/services/time-estimate";
import type { LocationValue } from "@openclaw-crm/shared";

export const dynamic = "force-dynamic";

/**
 * POST → recompute time estimate for the Auftrag of this Deal.
 *
 * Body (optional): { depotRecordId?: string }
 *   - If provided, pin the depot. Otherwise auto-pick by PLZ of the pickup
 *     address (or nearest depot by lat/lng) and persist the pick.
 *
 * Reads addresses LIVE from the Lead — never from the Auftrag. Single source
 * of truth. The Auftrag stores only the computed result.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { recordId: dealRecordId } = await params;

  const body = (await req.json().catch(() => ({}))) as { depotRecordId?: string };

  // ── Resolve the deal + lead context ─────────────────────────────────────
  const [dealObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, ctx.workspaceId), eq(objects.slug, "deals")))
    .limit(1);
  if (!dealObj) return badRequest("deals object not found in workspace");

  const deal = await getRecord(dealObj.id, dealRecordId);
  if (!deal) return badRequest("deal not found");

  const dv = deal.values as Record<string, unknown>;
  const moveFromRaw = dv.move_from_address as LocationValue | null | undefined;
  const moveToRaw = dv.move_to_address as LocationValue | null | undefined;
  const moveFromAddress = formatLocation(moveFromRaw);
  const moveToAddress = formatLocation(moveToRaw);
  if (!moveFromAddress || !moveToAddress) {
    // Distinct code so the UI can render the inline "Adresse eintragen / KI-
    // Analyse starten" fallback instead of just an error banner.
    return NextResponse.json(
      {
        error: {
          code: "MISSING_ADDRESSES",
          message:
            "Abhol- und Zieladresse müssen am Lead gepflegt sein, bevor die Schätzung läuft.",
        },
        missing: {
          from: !moveFromAddress,
          to: !moveToAddress,
        },
      },
      { status: 400 }
    );
  }

  // ── Resolve the auftraege object + the Auftrag linked to this Deal ─────
  const [auftragObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, ctx.workspaceId), eq(objects.slug, "auftraege")))
    .limit(1);
  if (!auftragObj) return badRequest("auftraege object not provisioned");

  const auftragAttrs = await db
    .select()
    .from(attributes)
    .where(eq(attributes.objectId, auftragObj.id));
  const auftragAttrBySlug = new Map(auftragAttrs.map((a) => [a.slug, a]));
  const dealRefAttr = auftragAttrBySlug.get("deal");
  if (!dealRefAttr) return badRequest("auftraege.deal attribute missing — run db:sync-objects");

  const [refRow] = await db
    .select({ recordId: recordValues.recordId })
    .from(recordValues)
    .innerJoin(records, eq(records.id, recordValues.recordId))
    .where(
      and(
        eq(records.objectId, auftragObj.id),
        eq(recordValues.attributeId, dealRefAttr.id),
        eq(recordValues.referencedRecordId, dealRecordId)
      )
    )
    .limit(1);
  if (!refRow) {
    return badRequest("Es existiert noch kein Auftrag für diesen Lead. Öffne erst den Auftrags-Tab.");
  }
  const auftragRecordId = refRow.recordId;
  const auftrag = await getRecord(auftragObj.id, auftragRecordId);
  if (!auftrag) return badRequest("auftrag record not found");

  const av = auftrag.values as Record<string, unknown>;

  // ── Resolve elevator option titles on the Lead ─────────────────────────
  const elevatorFromTitle = await resolveSelectTitle(dealObj.id, "elevator_from", dv);
  const elevatorToTitle = await resolveSelectTitle(dealObj.id, "elevator_to", dv);

  // ── Load active depots ────────────────────────────────────────────────
  const candidates = await loadActiveDepots(ctx.workspaceId);
  if (candidates.length === 0) {
    return badRequest(
      "Keine aktiven Depots — bitte mindestens ein Depot anlegen oder `pnpm db:sync-objects` ausführen."
    );
  }

  // ── Rank depots by real road distance to the pickup (one Distance Matrix
  //    call). Drives both the auto-pick (nearest Sixt center) and the UI's
  //    depot dropdown. Non-fatal if it fails for any reason other than a
  //    missing API key — we then fall back to the coarse PLZ/haversine pick.
  let ranking: DepotDistance[] = [];
  try {
    ranking = await rankDepotsToPickup({
      depots: candidates.map((d) => ({ id: d.id, lat: d.lat, lng: d.lng })),
      pickupAddress: moveFromAddress,
    });
  } catch (e) {
    if (e instanceof DriveTimeConfigError) {
      return NextResponse.json({ error: e.message, code: "no_api_key" }, { status: 503 });
    }
    ranking = [];
  }
  const rankById = new Map(ranking.map((r) => [r.depotId, r]));

  // ── Nearest depot by real drive time (ranking is sorted ascending by
  //    seconds). This single value drives BOTH the auto-pick and the
  //    "empfohlen" recommendation, so they can never contradict each other.
  const nearest = ranking.find((r) => Number.isFinite(r.seconds)) ?? null;
  const recommendedDepotId = nearest ? nearest.depotId : null;

  // ── Pick depot ─────────────────────────────────────────────────────────
  //  1. Explicit pick (UI dropdown / pinned on the Auftrag) wins.
  //  2. Otherwise auto-pick the nearest (= recommended) depot.
  //  3. Fall back to the coarse PLZ/haversine picker if ranking is empty.
  let chosenDepot: DepotCandidate | null = null;
  const explicitId = body.depotRecordId ?? extractRefId(av.depot);
  if (explicitId) {
    chosenDepot = candidates.find((d) => d.id === explicitId) ?? null;
  }
  if (!chosenDepot && recommendedDepotId) {
    chosenDepot = candidates.find((d) => d.id === recommendedDepotId) ?? null;
  }
  if (!chosenDepot) {
    chosenDepot = pickDepot(candidates, {
      plz: moveFromRaw?.postcode ?? null,
      lat: null,
      lng: null,
    });
  }
  if (!chosenDepot) return badRequest("Kein Depot wählbar.");

  // ── Ranked alternatives for the UI (nearest by time first; unreachable
  //    last). Empty when ranking failed, so the picker renders nothing
  //    instead of labelling every depot "keine Route".
  const depotOptions =
    ranking.length === 0
      ? []
      : candidates
          .map((d) => {
            const r = rankById.get(d.id);
            const reachable =
              !!r && r.status === "OK" && Number.isFinite(r.meters) && Number.isFinite(r.seconds);
            return {
              id: d.id,
              name: d.name,
              distanceMeters: reachable ? r!.meters : null,
              minutes: reachable ? Math.round(r!.seconds / 60) : null,
              reachable,
            };
          })
          .sort((a, b) => {
            if (a.minutes == null && b.minutes == null) return a.name.localeCompare(b.name);
            if (a.minutes == null) return 1;
            if (b.minutes == null) return -1;
            return a.minutes - b.minutes;
          });

  // ── Drive time (Google Distance Matrix) ───────────────────────────────
  const chosenRank = rankById.get(chosenDepot.id);
  let drive;
  try {
    drive = await estimateRoundTrip({
      depot: { label: chosenDepot.name, lat: chosenDepot.lat, lng: chosenDepot.lng },
      pickup: { label: "Abholung", address: moveFromAddress },
      dropoff: { label: "Ziel", address: moveToAddress },
      // Reuse the depot → pickup leg from the ranking call (saves one request).
      // Require finite meters AND seconds so a malformed element can never leak
      // Infinity into the persisted totals.
      depotToPickup:
        chosenRank &&
        chosenRank.status === "OK" &&
        Number.isFinite(chosenRank.meters) &&
        Number.isFinite(chosenRank.seconds)
          ? { meters: chosenRank.meters, seconds: chosenRank.seconds }
          : undefined,
    });
  } catch (e) {
    if (e instanceof DriveTimeConfigError) {
      return NextResponse.json(
        { error: e.message, code: "no_api_key" },
        { status: 503 }
      );
    }
    if (e instanceof DriveTimeAPIError) {
      return NextResponse.json(
        { error: e.message, code: "upstream" },
        { status: 502 }
      );
    }
    throw e;
  }

  const driveMinutesTotal = Math.round(drive.totalSeconds / 60);

  // ── Load/unload minutes ──────────────────────────────────────────────
  const loadUnloadMinutes = estimateLoadUnloadMinutes({
    volumeCbm: numberOrNull(av.volume_cbm),
    workerCount: numberOrNull(av.worker_count),
    floorsFrom: numberOrNull(dv.floors_from),
    floorsTo: numberOrNull(dv.floors_to),
    elevatorFrom: elevatorFromTitle,
    elevatorTo: elevatorToTitle,
    walkingDistanceFromM: numberOrNull(av.walking_distance_from_m),
    walkingDistanceToM: numberOrNull(av.walking_distance_to_m),
  });

  const totalMinutes = driveMinutesTotal + loadUnloadMinutes;

  // ── Persist on the Auftrag ────────────────────────────────────────────
  await updateRecord(
    auftragObj.id,
    auftragRecordId,
    {
      depot: chosenDepot.id,
      drive_segments_json: {
        legs: drive.legs,
        totalMeters: drive.totalMeters,
        totalSeconds: drive.totalSeconds,
        warnings: drive.warnings,
        depot: { id: chosenDepot.id, name: chosenDepot.name, lat: chosenDepot.lat, lng: chosenDepot.lng },
        pickupAddress: moveFromAddress,
        dropoffAddress: moveToAddress,
        depotOptions,
        recommendedDepotId,
      },
      drive_minutes_total: driveMinutesTotal,
      load_unload_minutes: loadUnloadMinutes,
      total_minutes: totalMinutes,
      time_estimate_computed_at: drive.computedAt,
    },
    ctx.userId
  );

  return success({
    depot: {
      id: chosenDepot.id,
      name: chosenDepot.name,
    },
    depotOptions,
    recommendedDepotId,
    legs: drive.legs,
    driveMinutesTotal,
    loadUnloadMinutes,
    totalMinutes,
    computedAt: drive.computedAt,
    warnings: drive.warnings,
    pickupAddress: moveFromAddress,
    dropoffAddress: moveToAddress,
  });
}

// ─── helpers ──────────────────────────────────────────────────────────────

function formatLocation(v: LocationValue | null | undefined): string | null {
  if (!v) return null;
  const parts = [v.line1, v.postcode, v.city, v.countryCode].filter((p): p is string => !!p && p.trim().length > 0);
  if (parts.length === 0) return null;
  return parts.join(", ");
}

function numberOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function extractRefId(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object" && v && "id" in v) {
    const id = (v as { id: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

async function resolveSelectTitle(
  objectId: string,
  slug: string,
  values: Record<string, unknown>
): Promise<string | null> {
  const v = values[slug];
  // Already resolved (getRecord may have done it)?
  if (typeof v === "string" && !/^[0-9a-f-]{36}$/i.test(v)) return v;
  if (v && typeof v === "object" && "title" in v) return (v as { title: string }).title;

  // Look up option title by id
  const id = typeof v === "string" ? v : null;
  if (!id) return null;
  const [opt] = await db
    .select({ title: selectOptions.title })
    .from(selectOptions)
    .where(eq(selectOptions.id, id))
    .limit(1);
  return opt?.title ?? null;
  // (objectId unused; reserved if we ever need to constrain the lookup)
  void objectId;
}

async function loadActiveDepots(workspaceId: string): Promise<DepotCandidate[]> {
  const [depotObj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "transport_depots")))
    .limit(1);
  if (!depotObj) return [];

  const depotAttrs = await db
    .select()
    .from(attributes)
    .where(eq(attributes.objectId, depotObj.id));
  const attrBySlug = new Map(depotAttrs.map((a) => [a.slug, a]));

  const allDepotRecords = await db
    .select({ id: records.id })
    .from(records)
    .where(eq(records.objectId, depotObj.id));

  const out: DepotCandidate[] = [];
  for (const r of allDepotRecords) {
    const vrows = await db
      .select()
      .from(recordValues)
      .where(eq(recordValues.recordId, r.id));
    const byAttrId = new Map(vrows.map((v) => [v.attributeId, v]));

    const getNum = (slug: string) => {
      const a = attrBySlug.get(slug);
      if (!a) return null;
      const raw = byAttrId.get(a.id)?.numberValue;
      return raw != null ? Number(raw) : null;
    };
    const getText = (slug: string) => {
      const a = attrBySlug.get(slug);
      if (!a) return null;
      return byAttrId.get(a.id)?.textValue ?? null;
    };
    const getBool = (slug: string) => {
      const a = attrBySlug.get(slug);
      if (!a) return null;
      return byAttrId.get(a.id)?.booleanValue ?? null;
    };

    const lat = getNum("lat");
    const lng = getNum("lng");
    const name = getText("name");
    if (lat == null || lng == null || !name) continue;

    // Honor the Settings "aktiv" toggle: a depot switched off must never be
    // ranked, auto-picked or shown in the calculator dropdown. Treat a null
    // flag as active (matches the seed + the ?? true default used elsewhere).
    const active = getBool("active") ?? true;
    if (!active) continue;

    out.push({
      id: r.id,
      name,
      lat,
      lng,
      cityTag: getText("city_tag"),
      plzPrefixes: getText("plz_prefixes"),
      serviceRadiusKm: getNum("service_radius_km"),
      active,
    });
  }
  return out;
}

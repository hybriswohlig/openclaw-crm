import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getAuthContext, unauthorized, badRequest, success } from "@/lib/api-utils";
import { db } from "@/db";
import { objects, attributes, selectOptions } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import { getRecord, updateRecord } from "@/services/records";
import {
  estimateRoundTrip,
  DriveTimeConfigError,
  DriveTimeAPIError,
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
    return badRequest(
      "Abhol- und Zieladresse müssen am Lead gepflegt sein, bevor die Schätzung läuft."
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

  // ── Pick depot ─────────────────────────────────────────────────────────
  let chosenDepot: DepotCandidate | null = null;
  const explicitId = body.depotRecordId ?? extractRefId(av.depot);
  if (explicitId) {
    chosenDepot = candidates.find((d) => d.id === explicitId) ?? null;
  }
  if (!chosenDepot) {
    chosenDepot = pickDepot(candidates, {
      plz: moveFromRaw?.postcode ?? null,
      lat: null,
      lng: null,
    });
  }
  if (!chosenDepot) return badRequest("Kein Depot wählbar.");

  // ── Drive time (Google Distance Matrix) ───────────────────────────────
  let drive;
  try {
    drive = await estimateRoundTrip({
      depot: { label: chosenDepot.name, lat: chosenDepot.lat, lng: chosenDepot.lng },
      pickup: { label: "Abholung", address: moveFromAddress },
      dropoff: { label: "Ziel", address: moveToAddress },
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

    out.push({
      id: r.id,
      name,
      lat,
      lng,
      cityTag: getText("city_tag"),
      plzPrefixes: getText("plz_prefixes"),
      serviceRadiusKm: getNum("service_radius_km"),
      active: getBool("active") ?? true,
    });
  }
  return out;
}

import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { badRequest, getAuthContext, requireAdmin, success, unauthorized } from "@/lib/api-utils";
import { db } from "@/db";
import { attributes, objects } from "@/db/schema/objects";
import { records, recordValues } from "@/db/schema/records";
import {
  KNOWN_OPERATING_COMPANIES,
  readEnrichmentSettings,
  writeEnrichmentSettings,
  type CompanySwitch,
  type EnrichmentSettings,
  type EnrichmentSettingsPatch,
} from "@/services/deal-enrichment-settings";

async function companyNames(workspaceId: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const [object] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, workspaceId), eq(objects.slug, "operating_companies")))
    .limit(1);
  if (!object) return names;
  const [nameAttr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, object.id), eq(attributes.slug, "name")))
    .limit(1);
  if (!nameAttr) return names;
  const rows = await db
    .select({ id: records.id, name: recordValues.textValue })
    .from(records)
    .leftJoin(
      recordValues,
      and(eq(recordValues.recordId, records.id), eq(recordValues.attributeId, nameAttr.id))
    )
    .where(eq(records.objectId, object.id));
  for (const row of rows) {
    if (row.name?.trim()) names.set(row.id, row.name.trim());
  }
  return names;
}

function present(settings: EnrichmentSettings, names: Map<string, string>) {
  const ids = new Set<string>([
    ...KNOWN_OPERATING_COMPANIES.map((company) => company.id),
    ...names.keys(),
    ...Object.keys(settings.operatingCompanies),
  ]);
  return {
    suggestionsEnabled: settings.suggestionsEnabled,
    autoWriteEnabled: settings.autoWriteEnabled,
    confidenceThreshold: settings.confidenceThreshold,
    emailSuggestionsEnabled: settings.emailDeals.suggestionsEnabled,
    emailAutoWriteEnabled: settings.emailDeals.autoWriteEnabled,
    operatingCompanies: [...ids].map((id) => {
      const stored = settings.operatingCompanies[id] ?? {};
      const email = settings.emailDeals.operatingCompanies[id] ?? {};
      const known = KNOWN_OPERATING_COMPANIES.find((company) => company.id === id);
      return {
        id,
        name: names.get(id) || known?.fallbackName || id,
        suggestionsEnabled: stored.suggestionsEnabled !== false,
        autoWriteEnabled: stored.autoWriteEnabled !== false,
        emailSuggestionsEnabled: email.suggestionsEnabled !== false,
        emailAutoWriteEnabled: email.autoWriteEnabled !== false,
      };
    }),
  };
}

/** GET /api/v1/settings/deal-enrichment — workspace and per-company kill switches. */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const admin = requireAdmin(ctx);
  if (admin) return admin;
  const settings = await readEnrichmentSettings(ctx.workspaceId);
  return success(present(settings, await companyNames(ctx.workspaceId)));
}

/** PATCH /api/v1/settings/deal-enrichment */
export async function PATCH(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const admin = requireAdmin(ctx);
  if (admin) return admin;

  const body = (await req.json().catch(() => null)) as
    | (EnrichmentSettingsPatch & {
        emailSuggestionsEnabled?: boolean;
        emailAutoWriteEnabled?: boolean;
        operatingCompanies?: Record<
          string,
          CompanySwitch & { emailSuggestionsEnabled?: boolean; emailAutoWriteEnabled?: boolean }
        >;
      })
    | null;
  if (!body || typeof body !== "object") return badRequest("JSON body required");
  const patch: EnrichmentSettingsPatch = {};
  if (typeof body.suggestionsEnabled === "boolean") patch.suggestionsEnabled = body.suggestionsEnabled;
  if (typeof body.autoWriteEnabled === "boolean") patch.autoWriteEnabled = body.autoWriteEnabled;
  if (body.confidenceThreshold !== undefined) {
    const threshold = Number(body.confidenceThreshold);
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
      return badRequest("confidenceThreshold must be between 0 and 1");
    }
    patch.confidenceThreshold = threshold;
  }
  if (body.operatingCompanies) {
    const cleaned: Record<string, CompanySwitch> = {};
    const emailCompanies: Record<string, CompanySwitch> = {};
    for (const [id, value] of Object.entries(body.operatingCompanies)) {
      if (!value || typeof value !== "object") continue;
      cleaned[id] = {
        suggestionsEnabled:
          typeof value.suggestionsEnabled === "boolean" ? value.suggestionsEnabled : undefined,
        autoWriteEnabled: typeof value.autoWriteEnabled === "boolean" ? value.autoWriteEnabled : undefined,
      };
      emailCompanies[id] = {
        suggestionsEnabled:
          typeof value.emailSuggestionsEnabled === "boolean" ? value.emailSuggestionsEnabled : undefined,
        autoWriteEnabled:
          typeof value.emailAutoWriteEnabled === "boolean" ? value.emailAutoWriteEnabled : undefined,
      };
    }
    patch.operatingCompanies = cleaned;
    patch.emailDeals = { ...(patch.emailDeals ?? {}), operatingCompanies: emailCompanies };
  }
  if (typeof body.emailSuggestionsEnabled === "boolean" || typeof body.emailAutoWriteEnabled === "boolean") {
    patch.emailDeals = {
      suggestionsEnabled:
        typeof body.emailSuggestionsEnabled === "boolean" ? body.emailSuggestionsEnabled : patch.emailDeals?.suggestionsEnabled,
      autoWriteEnabled:
        typeof body.emailAutoWriteEnabled === "boolean" ? body.emailAutoWriteEnabled : patch.emailDeals?.autoWriteEnabled,
      operatingCompanies: patch.emailDeals?.operatingCompanies ?? {},
    };
  }
  const settings = await writeEnrichmentSettings(ctx.workspaceId, patch);
  return success(present(settings, await companyNames(ctx.workspaceId)));
}

/**
 * Kill switches for deal-field enrichment.
 * Missing keys stay ON: suggestions and auto-write both default to enabled,
 * per workspace and per operating company. Either level can turn a switch off.
 */

import { getSetting, setSetting } from "@/services/workspace-settings";
import {
  CEYLAN_OPERATING_COMPANY_ID,
  DEFAULT_CONFIDENCE_THRESHOLD,
  KOTTKE_OPERATING_COMPANY_ID,
} from "@/lib/deal-enrichment-policy";

export const DEAL_ENRICHMENT_SETTING_KEY = "deal_enrichment";

export interface CompanySwitch {
  suggestionsEnabled?: boolean;
  autoWriteEnabled?: boolean;
}

export interface EmailDealSettings {
  suggestionsEnabled: boolean;
  autoWriteEnabled: boolean;
  operatingCompanies: Record<string, CompanySwitch>;
}

export interface EnrichmentSettings {
  suggestionsEnabled: boolean;
  autoWriteEnabled: boolean;
  confidenceThreshold: number;
  operatingCompanies: Record<string, CompanySwitch>;
  /** Direct-email deals. Same default-on shape as the field switches. */
  emailDeals: EmailDealSettings;
}

export const KNOWN_OPERATING_COMPANIES: Array<{ id: string; fallbackName: string }> = [
  { id: KOTTKE_OPERATING_COMPANY_ID, fallbackName: "Kottke" },
  { id: CEYLAN_OPERATING_COMPANY_ID, fallbackName: "Ceylan" },
];

export function parseEnrichmentSettings(raw: string | null | undefined): EnrichmentSettings {
  let parsed: Partial<EnrichmentSettings> = {};
  if (raw) {
    try {
      const value = JSON.parse(raw) as Partial<EnrichmentSettings>;
      if (value && typeof value === "object") parsed = value;
    } catch {
      parsed = {};
    }
  }
  const threshold = Number(parsed.confidenceThreshold);
  return {
    suggestionsEnabled: parsed.suggestionsEnabled !== false,
    autoWriteEnabled: parsed.autoWriteEnabled !== false,
    confidenceThreshold:
      Number.isFinite(threshold) && threshold > 0 && threshold <= 1
        ? threshold
        : DEFAULT_CONFIDENCE_THRESHOLD,
    operatingCompanies:
      parsed.operatingCompanies && typeof parsed.operatingCompanies === "object"
        ? parsed.operatingCompanies
        : {},
    emailDeals: parseEmailDeals(parsed.emailDeals),
  };
}

function parseEmailDeals(raw: unknown): EmailDealSettings {
  const value = raw && typeof raw === "object" ? (raw as Partial<EmailDealSettings>) : {};
  return {
    suggestionsEnabled: value.suggestionsEnabled !== false,
    autoWriteEnabled: value.autoWriteEnabled !== false,
    operatingCompanies:
      value.operatingCompanies && typeof value.operatingCompanies === "object" ? value.operatingCompanies : {},
  };
}

export function effectiveEnrichmentSwitches(
  settings: EnrichmentSettings,
  operatingCompanyId: string | null
): { suggestionsEnabled: boolean; autoWriteEnabled: boolean } {
  const company = operatingCompanyId ? settings.operatingCompanies[operatingCompanyId] : undefined;
  return {
    suggestionsEnabled: settings.suggestionsEnabled && company?.suggestionsEnabled !== false,
    autoWriteEnabled: settings.autoWriteEnabled && company?.autoWriteEnabled !== false,
  };
}

export function effectiveEmailDealSwitches(
  settings: EnrichmentSettings,
  operatingCompanyId: string | null
): { suggestionsEnabled: boolean; autoWriteEnabled: boolean } {
  const company = operatingCompanyId ? settings.emailDeals.operatingCompanies[operatingCompanyId] : undefined;
  return {
    suggestionsEnabled: settings.emailDeals.suggestionsEnabled && company?.suggestionsEnabled !== false,
    autoWriteEnabled: settings.emailDeals.autoWriteEnabled && company?.autoWriteEnabled !== false,
  };
}

export async function readEnrichmentSettings(workspaceId: string): Promise<EnrichmentSettings> {
  return parseEnrichmentSettings(await getSetting(workspaceId, DEAL_ENRICHMENT_SETTING_KEY));
}

export interface EnrichmentSettingsPatch {
  suggestionsEnabled?: boolean;
  autoWriteEnabled?: boolean;
  confidenceThreshold?: number;
  operatingCompanies?: Record<string, CompanySwitch>;
  emailDeals?: {
    suggestionsEnabled?: boolean;
    autoWriteEnabled?: boolean;
    operatingCompanies?: Record<string, CompanySwitch>;
  };
}

export async function writeEnrichmentSettings(
  workspaceId: string,
  patch: EnrichmentSettingsPatch
): Promise<EnrichmentSettings> {
  const current = await readEnrichmentSettings(workspaceId);
  const next: EnrichmentSettings = {
    suggestionsEnabled:
      typeof patch.suggestionsEnabled === "boolean" ? patch.suggestionsEnabled : current.suggestionsEnabled,
    autoWriteEnabled:
      typeof patch.autoWriteEnabled === "boolean" ? patch.autoWriteEnabled : current.autoWriteEnabled,
    confidenceThreshold:
      typeof patch.confidenceThreshold === "number" ? patch.confidenceThreshold : current.confidenceThreshold,
    operatingCompanies: { ...current.operatingCompanies },
    emailDeals: {
      suggestionsEnabled: current.emailDeals.suggestionsEnabled,
      autoWriteEnabled: current.emailDeals.autoWriteEnabled,
      operatingCompanies: { ...current.emailDeals.operatingCompanies },
    },
  };
  if (patch.emailDeals) {
    if (typeof patch.emailDeals.suggestionsEnabled === "boolean") {
      next.emailDeals.suggestionsEnabled = patch.emailDeals.suggestionsEnabled;
    }
    if (typeof patch.emailDeals.autoWriteEnabled === "boolean") {
      next.emailDeals.autoWriteEnabled = patch.emailDeals.autoWriteEnabled;
    }
    for (const [id, value] of Object.entries(patch.emailDeals.operatingCompanies ?? {})) {
      const prev = next.emailDeals.operatingCompanies[id] ?? {};
      next.emailDeals.operatingCompanies[id] = {
        suggestionsEnabled:
          typeof value?.suggestionsEnabled === "boolean" ? value.suggestionsEnabled : prev.suggestionsEnabled,
        autoWriteEnabled:
          typeof value?.autoWriteEnabled === "boolean" ? value.autoWriteEnabled : prev.autoWriteEnabled,
      };
    }
  }
  if (patch.operatingCompanies) {
    for (const [id, value] of Object.entries(patch.operatingCompanies)) {
      const prev = next.operatingCompanies[id] ?? {};
      next.operatingCompanies[id] = {
        suggestionsEnabled:
          typeof value?.suggestionsEnabled === "boolean" ? value.suggestionsEnabled : prev.suggestionsEnabled,
        autoWriteEnabled:
          typeof value?.autoWriteEnabled === "boolean" ? value.autoWriteEnabled : prev.autoWriteEnabled,
      };
    }
  }
  const normalized = parseEnrichmentSettings(JSON.stringify(next));
  await setSetting(workspaceId, DEAL_ENRICHMENT_SETTING_KEY, JSON.stringify(normalized));
  return normalized;
}

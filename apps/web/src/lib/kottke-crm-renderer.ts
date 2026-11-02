/**
 * Kottke stays on the crm-tools VPS template.
 *
 * The in-repo KV/AB/RE renderer (crm_render_document, crm_preview_document,
 * and crm_generate_document with renderer "crm") is rejected for this firm.
 * Same id as KOTTKE_OPERATING_COMPANY_ID in deal-enrichment-policy.
 */
export const KOTTKE_OPERATING_COMPANY_ID = "5af07382-33b5-4538-a6d5-017132543ac4";

export const KOTTKE_CRM_RENDERER_MESSAGE =
  "Für Kottke nur VPS-Template: crm_generate_document ohne renderer";

export function isKottkeFirma(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "kottke";
}

/** True when the operating company or an explicit firma slug is Kottke. */
export function blocksInRepoCrmRenderer(input: {
  firma?: string | null;
  operatingCompanyId?: string | null;
  operatingCompanyName?: string | null;
}): boolean {
  if (isKottkeFirma(input.firma)) return true;
  const id = input.operatingCompanyId?.trim().toLowerCase();
  if (id && id === KOTTKE_OPERATING_COMPANY_ID) return true;
  const name = input.operatingCompanyName?.trim().toLowerCase() ?? "";
  return name.includes("kottke");
}

/** Dashboard checkbox. Kottke has no in-repo renderer choice. */
export function showCrmRendererChoice(firma: string | null | undefined): boolean {
  return !isKottkeFirma(firma);
}

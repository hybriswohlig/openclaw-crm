import type { CustomerPortalContext } from "@openclaw-crm/customer-portal-core";

/**
 * Why a status link must not show customer data any more: revoked/expired
 * link, or the firma switched the portal off. `null` = link is usable.
 *
 * loadContextByToken still loads the full context in these cases because
 * internal code (confirmation mails, withdrawal handling) needs it, so every
 * PUBLIC surface (state JSON, link preview, OG image) has to check this.
 */
export function portalSperre(meta: {
  revoked: boolean;
  featureDisabled: boolean;
}): "revoked" | "disabled" | null {
  if (meta.revoked) return "revoked";
  if (meta.featureDisabled) return "disabled";
  return null;
}

/**
 * Kein Kundenname: Die Vorschau sieht jeder, an den der Link weitergeleitet
 * wird, bevor er ihn öffnet. Der Name steht erst im Portal selbst.
 */
export interface PortalPreview {
  neutral: boolean;
  firma: string;
  dealNumber: string;
  primaryColor: string | null;
}

const NEUTRAL: PortalPreview = {
  neutral: true,
  firma: "Auftrag",
  dealNumber: "",
  primaryColor: null,
};

/** What a link preview (page metadata, OG/Twitter card) may show. */
export function portalPreview(
  ctx: Pick<CustomerPortalContext, "branding" | "dealNumber" | "meta"> | null
): PortalPreview {
  if (!ctx || portalSperre(ctx.meta)) return NEUTRAL;
  return {
    neutral: false,
    firma: ctx.branding.displayName,
    dealNumber: ctx.dealNumber,
    primaryColor: ctx.branding.primaryColor,
  };
}

import { kottkeRestbetragSatz } from "@openclaw-crm/document-templates/src/restbetrag";

/**
 * Customer-portal sentence for Kottke only. A move (or an unknown service)
 * uses the Umzugstag wording. Kitchen and clearance use Einsatztag.
 * Ceylan keeps its own payment texts.
 */
export function portalRestbetragSatz(
  firmaSlug: string | null | undefined,
  serviceType: string | null | undefined,
): string | null {
  if (firmaSlug !== "kottke") return null;
  const umzug = serviceType == null || serviceType === "move";
  return kottkeRestbetragSatz(umzug);
}

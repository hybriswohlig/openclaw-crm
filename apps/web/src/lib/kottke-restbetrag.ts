import { kottkeRestbetragSatz } from "@openclaw-crm/document-templates/src/restbetrag";

/**
 * Customer-portal sentence for every company. The portal text is shared.
 * A move (or an unknown service) uses the Umzugstag wording. Kitchen and
 * clearance use Einsatztag. `firmaSlug` stays in the signature so callers
 * do not change; it does not pick a different payment term.
 */
export function portalRestbetragSatz(
  firmaSlug: string | null | undefined,
  serviceType: string | null | undefined,
): string | null {
  void firmaSlug;
  const umzug = serviceType == null || serviceType === "move";
  return kottkeRestbetragSatz(umzug);
}

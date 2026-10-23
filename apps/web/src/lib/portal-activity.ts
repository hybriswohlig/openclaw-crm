/**
 * Activity-feed copy for portal requests and the signature that follows them.
 * The raw event type is not something a person can read on the deal.
 */

const REQUEST_TITLES: Record<string, string> = {
  "customer.question": "Änderung angefragt",
  "customer.reschedule_requested": "Terminänderung angefragt",
  "customer.damage_reported": "Schaden gemeldet",
};

export function portalActivityCopy(
  eventType: string,
  payload: Record<string, unknown>
): { title: string; description?: string } | null {
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  const requestTitle = REQUEST_TITLES[eventType];
  if (requestTitle) {
    const dates = Array.isArray(payload.preferredDates)
      ? payload.preferredDates.filter((d): d is string => typeof d === "string" && d.length > 0)
      : [];
    const description = [message, dates.length > 0 ? `Wunschtermine: ${dates.join(", ")}` : ""]
      .filter(Boolean)
      .join("\n");
    return { title: requestTitle, description: description || undefined };
  }
  if (eventType === "customer.change_request_handled") {
    return {
      title: "Änderungsanfrage erledigt",
      description: message || undefined,
    };
  }
  if (eventType === "customer.kva_signed") {
    return { title: "Vertrag im Kundenportal unterschrieben" };
  }
  if (eventType === "kva.annahme_aufgehoben") {
    const grund = typeof payload.grund === "string" ? payload.grund.trim() : "";
    return {
      title: "Annahme aufgehoben",
      description: grund || undefined,
    };
  }
  return null;
}

import { toast } from "sonner";
import { apiAufruf, jsonAufruf } from "./api";

/**
 * Eine Meldung „Ich habe bezahlt“ bestätigen oder verwerfen (Entscheidung 6),
 * gemeinsam für Ablauf-Panel, Dock und Zahlungsdialog. 200 und 409 ERLEDIGT
 * laden die Akte neu; jede andere Serverantwort (etwa 404, die Meldung gibt es
 * nicht mehr) auch, damit kein veralteter Knopf stehen bleibt. Nur ohne
 * Verbindung (Status 0) bleibt die Seite, wie sie ist.
 */
export async function meldungBearbeiten(
  dealId: string,
  eventId: string,
  aktion: "bestaetigen" | "verwerfen"
): Promise<{ ok: boolean; neuLaden: boolean }> {
  const r = await apiAufruf<{ paymentId?: string; verworfen?: true }>(
    `/api/v1/deals/${dealId}/payment-reports/${eventId}`,
    jsonAufruf("POST", { aktion })
  );
  if (r.ok) {
    toast.success(aktion === "bestaetigen" ? "Zahlung bestätigt." : "Meldung verworfen.");
  } else if (r.status === 409 && r.code === "ERLEDIGT") {
    toast.error(r.message);
  } else {
    toast.error(aktion === "bestaetigen" ? "Zahlung konnte nicht bestätigt werden." : "Meldung konnte nicht verworfen werden.", {
      description: r.message,
    });
  }
  return { ok: r.ok, neuLaden: r.ok || r.status !== 0 };
}

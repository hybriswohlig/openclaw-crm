"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { apiAufruf, jsonAufruf } from "@/components/neu/akte/api";
import { CRM_UI_CLIENT_HEADER, CRM_UI_CLIENT_VALUE } from "@/lib/deal-source";
import type { InboxEintrag, Kurzfassung } from "@/lib/inbox-neu";
import { keinLeadSetztStufe } from "./inbox-logik";

/** So lange bleibt der Toast mit „Rückgängig“ stehen. */
const RUECKGAENGIG_MS = 8000;

export interface LaneAktionen {
  /** Lane `kein_lead` für alle Gespräche des Eintrags; mit Deal auch die Stufe „Kein Lead“ (außer gebucht). */
  keinLead: () => Promise<void>;
  /** Lane `info` für alle Gespräche des Eintrags. */
  info: () => Promise<void>;
  /** Zurück in die Hauptliste: Lane `lead`. */
  lead: () => Promise<void>;
  laeuft: boolean;
}

/** Lane an jedem Gespräch setzen; die erste Fehlermeldung oder null. */
async function laneSetzen(ids: readonly string[], lane: "kein_lead" | "info" | "lead"): Promise<string | null> {
  const antworten = await Promise.all(
    ids.map((id) => apiAufruf<unknown>(`/api/v1/inbox/conversations/${encodeURIComponent(id)}`, jsonAufruf("PATCH", { lane })))
  );
  const fehler = antworten.find((r) => !r.ok);
  return fehler && !fehler.ok ? fehler.message : null;
}

/** Stufe des Deals über denselben Weg wie `StufenMenue` (deal.stage_changed, Wartet laufen wie heute). */
async function stufeSetzen(dealId: string, stufeId: string): Promise<string | null> {
  const r = await apiAufruf<unknown>(
    `/api/v1/objects/deals/records/${encodeURIComponent(dealId)}`,
    jsonAufruf("PATCH", { values: { stage: stufeId } }, { [CRM_UI_CLIENT_HEADER]: CRM_UI_CLIENT_VALUE })
  );
  return r.ok ? null : r.message;
}

/**
 * „Kein Lead“, „Info“ und „Lead“ für einen Eintrag (Plan 6, Entscheidung 12).
 * Beide ersten Wege zeigen einen Toast mit „Rückgängig“, der Lane (und Stufe)
 * zurücksetzt. Nach jeder Aktion lädt `onNeuLaden` Liste und Gespräch neu.
 */
export function useLaneAktionen({
  eintrag,
  kurz,
  onNeuLaden,
}: {
  eintrag: Pick<InboxEintrag, "dealId" | "gespraechIds"> | null;
  kurz: Pick<Kurzfassung, "stufe" | "keinLeadStufeId" | "kategorie"> | null;
  onNeuLaden: () => Promise<unknown>;
}): LaneAktionen {
  const [laeuft, setLaeuft] = useState(false);
  const ids = eintrag?.gespraechIds ?? [];
  const dealId = eintrag?.dealId ?? null;

  const rueckgaengig = useCallback(
    async (stufeZurueck: string | null) => {
      const f = await laneSetzen(ids, "lead");
      if (f) {
        toast.error("Rückgängig fehlgeschlagen.", { description: f });
        return;
      }
      if (stufeZurueck && dealId) {
        const f2 = await stufeSetzen(dealId, stufeZurueck);
        if (f2) toast.error("Stufe konnte nicht zurückgesetzt werden.", { description: f2 });
      }
      toast.success("Zurückgenommen.");
      await onNeuLaden();
    },
    [ids, dealId, onNeuLaden]
  );

  const keinLead = useCallback(async () => {
    if (ids.length === 0 || laeuft) return;
    setLaeuft(true);
    const f = await laneSetzen(ids, "kein_lead");
    if (f) {
      setLaeuft(false);
      toast.error("„Kein Lead“ konnte nicht gesetzt werden.", { description: f });
      return;
    }
    // Stufe nur bei offenen Deals; gebuchte und bezahlte behalten ihre Stufe (Hinweis im Toast).
    const stufeWechsel = dealId && kurz && keinLeadSetztStufe(kurz) ? { von: kurz.stufe.id, nach: kurz.keinLeadStufeId! } : null;
    const gebucht = Boolean(dealId && kurz && kurz.keinLeadStufeId && !keinLeadSetztStufe(kurz));
    let stufeGesetzt = false;
    if (stufeWechsel && dealId) {
      const f2 = await stufeSetzen(dealId, stufeWechsel.nach);
      if (f2) toast.error("Stufe konnte nicht gesetzt werden.", { description: f2 });
      else stufeGesetzt = true;
    }
    setLaeuft(false);
    const zurueck = stufeGesetzt && stufeWechsel ? stufeWechsel.von : null;
    toast.success("Als „Kein Lead“ abgelegt.", {
      description: gebucht ? "Der Deal ist gebucht, die Stufe bleibt." : undefined,
      duration: RUECKGAENGIG_MS,
      action: { label: "Rückgängig", onClick: () => void rueckgaengig(zurueck) },
    });
    await onNeuLaden();
  }, [ids, dealId, kurz, laeuft, onNeuLaden, rueckgaengig]);

  const info = useCallback(async () => {
    if (ids.length === 0 || laeuft) return;
    setLaeuft(true);
    const f = await laneSetzen(ids, "info");
    setLaeuft(false);
    if (f) {
      toast.error("„Info“ konnte nicht gesetzt werden.", { description: f });
      return;
    }
    toast.success("Als „Info“ abgelegt.", {
      duration: RUECKGAENGIG_MS,
      action: { label: "Rückgängig", onClick: () => void rueckgaengig(null) },
    });
    await onNeuLaden();
  }, [ids, laeuft, onNeuLaden, rueckgaengig]);

  const lead = useCallback(async () => {
    if (ids.length === 0 || laeuft) return;
    setLaeuft(true);
    const f = await laneSetzen(ids, "lead");
    setLaeuft(false);
    if (f) {
      toast.error("Konnte nicht als Lead einordnen.", { description: f });
      return;
    }
    toast.success("Wieder in der Hauptliste.");
    await onNeuLaden();
  }, [ids, laeuft, onNeuLaden]);

  return { keinLead, info, lead, laeuft };
}

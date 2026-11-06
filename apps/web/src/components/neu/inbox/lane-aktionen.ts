"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { apiAufruf, jsonAufruf } from "@/components/neu/akte/api";
import { CRM_UI_CLIENT_HEADER, CRM_UI_CLIENT_VALUE } from "@/lib/deal-source";
import type { InboxEintrag, Kurzfassung } from "@/lib/inbox-neu";
import type { Gespraech } from "@/services/gespraech";
import {
  keinLeadSetztStufe,
  laneMeldung,
  rueckgaengigMeldung,
  zielGespraeche,
  type LaneZiel,
  type Schluessel,
} from "./inbox-logik";

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
  /** False, wenn keine Zielgespräche bekannt sind: Knöpfe gesperrt. */
  moeglich: boolean;
}

interface LaneErgebnis {
  erfolge: string[];
  fehler: { id: string; message: string }[];
}

/** Lane an jedem Gespräch setzen; alle laufen, auch wenn eines scheitert. */
async function laneSetzen(ids: readonly string[], lane: LaneZiel): Promise<LaneErgebnis> {
  const ergebnisse = await Promise.allSettled(
    ids.map((id) => apiAufruf<unknown>(`/api/v1/inbox/conversations/${encodeURIComponent(id)}`, jsonAufruf("PATCH", { lane })))
  );
  const aus: LaneErgebnis = { erfolge: [], fehler: [] };
  ergebnisse.forEach((r, i) => {
    const id = ids[i]!;
    if (r.status === "fulfilled" && r.value.ok) aus.erfolge.push(id);
    else aus.fehler.push({ id, message: r.status === "fulfilled" && !r.value.ok ? r.value.message : "Keine Verbindung zum Server." });
  });
  return aus;
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
 * „Kein Lead“, „Info“ und „Als Lead“ für einen Eintrag (Plan 6, Entscheidung 12).
 * Ziele: die Gespräche des Listeneintrags, sonst die direkt verknüpften Kanäle
 * des geladenen Gesprächs, sonst der Schlüssel (Review I4). Alle PATCHes laufen;
 * danach wird immer neu geladen. Bei Teilfehlern nennt der Toast die Zahlen,
 * „Rückgängig“ gilt für die erfolgreichen (Review I3). „Rückgängig“ meldet nur
 * dann „Zurückgenommen.“, wenn auch die Stufe zurück ist (Review M1).
 */
export function useLaneAktionen({
  eintrag,
  gespraech,
  schluessel,
  kurz,
  onNeuLaden,
}: {
  eintrag: Pick<InboxEintrag, "dealId" | "gespraechIds"> | null;
  gespraech: Pick<Gespraech, "kanaele"> | null;
  schluessel: Schluessel | null;
  kurz: Pick<Kurzfassung, "stufe" | "keinLeadStufeId" | "kategorie"> | null;
  onNeuLaden: () => Promise<unknown>;
}): LaneAktionen {
  const [laeuft, setLaeuft] = useState(false);
  const ids = useMemo(() => zielGespraeche(eintrag, gespraech, schluessel), [eintrag, gespraech, schluessel]);
  const dealId = eintrag?.dealId ?? (schluessel?.art === "deal" ? schluessel.id : null);

  const rueckgaengig = useCallback(
    async (zurueckIds: readonly string[], stufeZurueck: string | null) => {
      const r = await laneSetzen(zurueckIds, "lead");
      let stufe: "keine" | "ok" | "fehler" = "keine";
      if (stufeZurueck && dealId) stufe = (await stufeSetzen(dealId, stufeZurueck)) ? "fehler" : "ok";
      const m = rueckgaengigMeldung({ erfolge: r.erfolge.length, fehler: r.fehler.length, stufe });
      const beschreibung = [m.beschreibung, r.fehler[0]?.message].filter(Boolean).join(" ");
      if (m.ok) toast.success(m.titel);
      else toast.error(m.titel, { description: beschreibung || undefined });
      await onNeuLaden();
    },
    [dealId, onNeuLaden]
  );

  const umstellen = useCallback(
    async (lane: LaneZiel) => {
      if (ids.length === 0 || laeuft) return;
      setLaeuft(true);
      const r = await laneSetzen(ids, lane);

      // Stufe nur bei „Kein Lead“, nur mit Deal und offener Stufe, und nur wenn alle Gespräche umgestellt sind.
      const stufeWechsel =
        lane === "kein_lead" && dealId && kurz && keinLeadSetztStufe(kurz) ? { von: kurz.stufe.id, nach: kurz.keinLeadStufeId! } : null;
      const gebucht = lane === "kein_lead" && Boolean(dealId && kurz && kurz.keinLeadStufeId && !keinLeadSetztStufe(kurz));
      let stufeGesetzt = false;
      let stufeFehler: string | null = null;
      if (stufeWechsel && dealId && r.fehler.length === 0) {
        stufeFehler = await stufeSetzen(dealId, stufeWechsel.nach);
        stufeGesetzt = stufeFehler === null;
      }
      setLaeuft(false);

      const zusatz = [
        gebucht ? "Der Deal ist gebucht, die Stufe bleibt." : null,
        stufeFehler ? `Stufe konnte nicht gesetzt werden. ${stufeFehler}` : null,
        r.fehler[0]?.message ?? null,
      ]
        .filter(Boolean)
        .join(" ");
      const m = laneMeldung(lane, r.erfolge.length, r.fehler.length, zusatz || undefined);
      const zurueck = stufeGesetzt && stufeWechsel ? stufeWechsel.von : null;
      const aktion = m.rueckgaengig ? { label: "Rückgängig", onClick: () => void rueckgaengig(r.erfolge, zurueck) } : undefined;
      if (m.art === "fehler") toast.error(m.titel, { description: m.beschreibung });
      else if (m.art === "teil") toast.warning(m.titel, { description: m.beschreibung, duration: RUECKGAENGIG_MS, action: aktion });
      else toast.success(m.titel, { description: m.beschreibung, duration: aktion ? RUECKGAENGIG_MS : undefined, action: aktion });
      await onNeuLaden();
    },
    [ids, dealId, kurz, laeuft, onNeuLaden, rueckgaengig]
  );

  const keinLead = useCallback(() => umstellen("kein_lead"), [umstellen]);
  const info = useCallback(() => umstellen("info"), [umstellen]);
  const lead = useCallback(() => umstellen("lead"), [umstellen]);

  return { keinLead, info, lead, laeuft, moeglich: ids.length > 0 };
}

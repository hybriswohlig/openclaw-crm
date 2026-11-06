/**
 * Nachfass-Schalter je Deal (Plan 3, Entscheidung 8): reine Anzeige-Logik.
 * Der Schalter hat keine eigene Spalte, er spiegelt die Flags, die der
 * Nachfass-Motor heute schon liest (`nachfass_deal_state.stop_reason`,
 * `deal_agent_state.human_owned`, `inbox_conversations.ai_paused`), und die
 * Auto-Versand-Bedingungen der nächsten Regel. Kein Datenbankzugriff.
 */
import {
  ABSCHLUSS_NACH_MS,
  FU1_NACH_MS,
  FU2_NACH_MS,
} from "@/services/nachfass/konstanten";

export type NachfassModus = "aus" | "sendet" | "entwurf" | "beendet";

export interface NachfassRegelStand {
  tag: 2 | 7 | 10;
  gesendetAm: string | null;
  geplantAm: string | null;
  art: "auto" | "entwurf";
}

/** Regeln der Kundensequenz ab Angebot (Motor: `entscheideNachfass`, fu1/fu2/tag10). */
export type SchalterRegel = "a1" | "a2" | "a3";

/** stop_reason, die der Schalter selbst setzt oder wieder löschen darf. */
export const SCHALTER_STOPS: readonly string[] = ["inhaber_aus", "human_owned", "ai_paused"];

export function istSchalterStop(stopReason: string | null): boolean {
  return stopReason !== null && SCHALTER_STOPS.includes(stopReason);
}

const TEXT: Record<"aus" | "von_hand" | "sendet" | "entwurf" | "beendet", string> = {
  aus: "aus",
  von_hand: "aus · von Hand übernommen",
  sendet: "automatisch, sendet",
  entwurf: "automatisch, Entwurf zur Freigabe",
  beendet: "beendet",
};

export function nachfassModus(e: {
  stopReason: string | null;
  stageCategory: string | null;
  humanOwned: boolean;
  aiPaused: boolean;
  dryRun: boolean;
  autoSendNaechsteRegel: boolean;
  genugFreigaben: boolean;
}): { an: boolean; modus: NachfassModus; text: string } {
  if (e.stageCategory === "lost" || e.stageCategory === "kein_lead") {
    return { an: false, modus: "beendet", text: TEXT.beendet };
  }
  if (e.stopReason !== null && !istSchalterStop(e.stopReason)) {
    return { an: false, modus: "beendet", text: TEXT.beendet };
  }
  if (e.stopReason === "inhaber_aus") return { an: false, modus: "aus", text: TEXT.aus };
  if (e.humanOwned || e.stopReason === "human_owned") {
    return { an: false, modus: "aus", text: TEXT.von_hand };
  }
  if (e.aiPaused || e.stopReason === "ai_paused") return { an: false, modus: "aus", text: TEXT.aus };
  if (!e.dryRun && e.autoSendNaechsteRegel && e.genugFreigaben) {
    return { an: true, modus: "sendet", text: TEXT.sendet };
  }
  return { an: true, modus: "entwurf", text: TEXT.entwurf };
}

export interface NachfassGesendet {
  fu1SentAt: Date | null;
  fu2SentAt: Date | null;
  closeSentAt: Date | null;
}

const SCHRITTE: readonly {
  tag: 2 | 7 | 10;
  regel: SchalterRegel;
  feld: keyof NachfassGesendet;
  nachMs: number;
}[] = [
  { tag: 2, regel: "a1", feld: "fu1SentAt", nachMs: FU1_NACH_MS },
  { tag: 7, regel: "a2", feld: "fu2SentAt", nachMs: FU2_NACH_MS },
  { tag: 10, regel: "a3", feld: "closeSentAt", nachMs: ABSCHLUSS_NACH_MS },
];

/** Regel des nächsten Schritts: die erste noch nicht gesendete, sonst null. */
export function naechsteRegel(gesendet: NachfassGesendet): SchalterRegel | null {
  return SCHRITTE.find((s) => !gesendet[s.feld])?.regel ?? null;
}

export interface NachfassStandEingabe {
  stopReason: string | null;
  stageCategory: string | null;
  humanOwned: boolean;
  aiPaused: boolean;
  dryRun: boolean;
  gesendet: NachfassGesendet;
  /** Angebotsdatum (KV-Version `sent_at`, sonst KV-Dokument `uploaded_at`). */
  angebotAm: Date | null;
  /** Je Regel: Regel-Schalter `auto_send` und genug saubere Freigaben. */
  regeln: Record<SchalterRegel, { autoSend: boolean; genugFreigaben: boolean }>;
}

export function nachfassStand(e: NachfassStandEingabe): {
  an: boolean;
  modus: NachfassModus;
  text: string;
  regeln: NachfassRegelStand[];
} {
  const naechste = naechsteRegel(e.gesendet);
  const kopf = nachfassModus({
    stopReason: e.stopReason,
    stageCategory: e.stageCategory,
    humanOwned: e.humanOwned,
    aiPaused: e.aiPaused,
    dryRun: e.dryRun,
    autoSendNaechsteRegel: naechste ? e.regeln[naechste].autoSend : false,
    genugFreigaben: naechste ? e.regeln[naechste].genugFreigaben : false,
  });
  const regeln = SCHRITTE.map((s): NachfassRegelStand => {
    const gesendetAm = e.gesendet[s.feld];
    const r = e.regeln[s.regel];
    return {
      tag: s.tag,
      gesendetAm: gesendetAm ? gesendetAm.toISOString() : null,
      geplantAm:
        !gesendetAm && kopf.an && e.angebotAm
          ? new Date(e.angebotAm.getTime() + s.nachMs).toISOString()
          : null,
      art: kopf.an && !e.dryRun && r.autoSend && r.genugFreigaben ? "auto" : "entwurf",
    };
  });
  return { ...kopf, regeln };
}

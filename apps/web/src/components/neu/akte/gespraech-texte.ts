/**
 * Reine Logik des Eingabefelds und der Entwurf-Karte (Plan 3, Task 13):
 * Fehlertexte je Code, Fenster-Sperre, Folge von „WhatsApp starten“.
 * Keine React-Abhängigkeit, damit die Tests leicht bleiben.
 */

/** Fehlertext je Code der Senderoute (`POST /inbox/conversations/{id}/messages`); sonst „Senden fehlgeschlagen.“ */
export function sendeFehler(code: string | null, meldung: string): string {
  switch (code) {
    case "WA_SESSION_EXPIRED":
      return "24-Stunden-Fenster zu.";
    case "BAILEYS_BRIDGE_NOT_CONFIGURED":
      return "WhatsApp ist für diese Nummer nicht verbunden.";
    case "BAILEYS_BRIDGE_ERROR":
      return "WhatsApp hat nicht geantwortet. Bitte erneut senden.";
    default:
      return meldung.trim() !== "" ? `Senden fehlgeschlagen. ${meldung.trim()}` : "Senden fehlgeschlagen.";
  }
}

/** Deutsche Bezeichnung der Gate-Gründe aus `services/agent/agent-gate.ts`. */
const GATE_GRUND: Record<string, string> = {
  consent_unknown_person: "Keine Einwilligung für diese Person.",
  no_proactive_consent: "Keine Einwilligung für Nachfass-Nachrichten.",
  consent_lookup_error: "Einwilligung konnte nicht geprüft werden.",
  human_owned: "Von Hand übernommen.",
  ai_paused: "Automatik an diesem Gespräch pausiert.",
  ai_hold: "Gespräch ist noch in Wartezeit.",
  suppressed: "Kunde hat Stopp gesagt.",
  // Ruhezeiten des Agenten (isWithinSendWindow), nicht das WABA-Fenster.
  outside_send_window: "Außerhalb der Sendezeit (8 bis 20 Uhr, sonntags 10 bis 19 Uhr).",
  min_gap: "Zu kurz nach der letzten Nachricht.",
  master_switch_off: "Automatik ist ausgeschaltet.",
  master_switch_error: "Automatik konnte nicht geprüft werden.",
  stage_terminal: "Deal ist abgeschlossen.",
  stage_unmapped: "Stufe ist der Automatik nicht zugeordnet.",
  deal_or_stage_missing: "Deal oder Stufe fehlt.",
  lane_not_lead: "Gespräch ist kein Lead.",
  conversation_missing: "Gespräch nicht gefunden.",
  conversation_required: "Entwurf hat kein Gespräch.",
};

const GATE_ALLGEMEIN = "Senden ist für diesen Kunden gesperrt.";

/** Gründe des Gates deutsch; unbekannte Codes werden zur allgemeinen Sperre, jede Aussage nur einmal. */
export function gateGruende(reasons: readonly string[] | undefined): string[] {
  const aus: string[] = [];
  for (const r of reasons ?? []) {
    const text = GATE_GRUND[r]
      ?? (r.startsWith("stopped_")
        ? "Sequenz beendet."
        : r.startsWith("stage_disallows_")
          ? "Stufe erlaubt diese Nachricht nicht."
          : GATE_ALLGEMEIN);
    if (!aus.includes(text)) aus.push(text);
  }
  return aus.length > 0 ? aus : [GATE_ALLGEMEIN];
}

/**
 * Body der Freigabe aus der Entwurf-Karte. Die Karte sendet nur den
 * unveränderten Entwurf (Bearbeiten geht übers Eingabefeld), deshalb ohne
 * `finalText`: ein eigener Text gälte in `draft-senden.ts` als vom Inhaber
 * geschrieben und überspränge die Veraltet-Prüfung (`stale`).
 */
export function freigabeBody(): { action: "approve_and_send"; humanApproved: true } {
  return { action: "approve_and_send", humanApproved: true };
}

/** Deutsche Meldung je Fehlerwort der Freigabe (`PATCH /agent-drafts/{id}`, `approve_and_send`). */
export function freigabeFehler(fehler: string | undefined, reasons?: readonly string[], detail?: string): string {
  switch (fehler) {
    case "gate_blocked":
      return `Gesperrt: ${gateGruende(reasons).join(" ")}`;
    case "price_leak":
      return "Preisprüfung hat blockiert. Bitte von Hand prüfen und senden.";
    case "session_expired":
      return detail?.trim() || "24-Stunden-Fenster zu.";
    case "send_uncertain":
      return detail?.trim() || "Zustellung unklar. Bitte den Verlauf prüfen, nichts erneut senden.";
    case "expired":
      return "Entwurf abgelaufen.";
    case "stale":
      return "Kunde hat neu geschrieben, der Entwurf ist überholt.";
    case "not_pending":
      return "Bereits bearbeitet.";
    case "no_conversation":
      return "Kein Gespräch für diesen Entwurf.";
    default:
      return "Senden fehlgeschlagen. Bitte erneut versuchen.";
  }
}

/** WABA außerhalb des 24-Stunden-Fensters: nur eine Vorlage geht noch. */
export function fensterZu(k: { istWaba: boolean; imFenster: boolean | null } | undefined): boolean {
  return Boolean(k && k.istWaba && k.imFenster === false);
}

/** Alte Inbox mit geöffnetem Gespräch. */
export function posteingangUrl(conversationId: string): string {
  return `/inbox?conv=${encodeURIComponent(conversationId)}`;
}

export type StartFolge =
  /** Es gibt noch kein Gespräch: Verfassen-Seite der alten Inbox (Abfrage wie `records/record-table.tsx`). */
  | { art: "verfassen"; url: string }
  /** Gespräch gibt es schon (jetzt am Deal): Akte neu laden. */
  | { art: "neu_laden"; conversationId: string }
  | { art: "unbekannt" };

export type NachStart =
  /** Das Gespräch hängt jetzt am Deal und ist sendefähig: wählen, kein Hinweis. */
  | { art: "waehlen"; gespraechId: string }
  /** Nur indirekt (anderer Deal) oder nicht sendefähig: Hinweis mit Sprung in die alte Inbox. */
  | { art: "hinweis"; text: string; link: { url: string; text: string } };

/**
 * Entscheidung nach `open`, aus den frisch geladenen Kanälen (nicht aus dem
 * Stand vor dem Neuladen).
 */
export function nachStart(
  kanaele: readonly { gespraechId: string; kannSenden: boolean }[],
  conversationId: string
): NachStart {
  const k = kanaele.find((x) => x.gespraechId === conversationId);
  if (k?.kannSenden) return { art: "waehlen", gespraechId: k.gespraechId };
  return {
    art: "hinweis",
    text: "Das WhatsApp-Gespräch hängt an einem anderen Deal und lässt sich hier nicht senden.",
    link: { url: posteingangUrl(conversationId), text: "Im Posteingang öffnen" },
  };
}

/** Folge der Antwort von `POST /inbox/whatsapp/start-from-record` (`StartFromRecordResult`). */
export function startFolge(data: unknown): StartFolge {
  if (!data || typeof data !== "object") return { art: "unbekannt" };
  const d = data as Record<string, unknown>;
  if (d.mode === "open" && typeof d.conversationId === "string" && d.conversationId !== "") {
    return { art: "neu_laden", conversationId: d.conversationId };
  }
  if (
    d.mode === "compose" &&
    typeof d.channelAccountId === "string" &&
    typeof d.toPhone === "string" &&
    typeof d.dealRecordId === "string"
  ) {
    const q = new URLSearchParams({
      compose: "1",
      channelAccountId: d.channelAccountId,
      phone: d.toPhone,
      name: typeof d.customerName === "string" ? d.customerName : "",
      dealRecordId: d.dealRecordId,
    });
    return { art: "verfassen", url: `/inbox?${q.toString()}` };
  }
  return { art: "unbekannt" };
}

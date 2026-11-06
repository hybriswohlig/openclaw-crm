"use client";

import { useEffect, useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import { apiAufruf } from "./api";

export interface Entwurf {
  id: string;
  messageClass: string;
  text: string;
  priceFlag: boolean;
  uncertain: boolean;
  createdAt: string;
}

const KLASSE_LABEL: Record<string, string> = {
  followup: "Nachfass",
  reply: "Antwort",
  first_contact: "Erstkontakt",
};

/** Deutsche Meldung je Fehlerwort der Freigabe (`PATCH /agent-drafts/{id}`). */
export function freigabeFehler(fehler: string | undefined, reasons?: string[], detail?: string): string {
  switch (fehler) {
    case "gate_blocked":
      return `Gesperrt: ${(reasons ?? []).join(", ") || "Freigabe nicht möglich"}.`;
    case "price_leak":
      return "Preisprüfung hat blockiert. Bitte von Hand prüfen und senden.";
    case "session_expired":
      return detail ?? "24-Stunden-Fenster zu.";
    case "send_uncertain":
      return detail ?? "Zustellung unklar. Bitte den Verlauf prüfen, nichts erneut senden.";
    case "expired":
      return "Entwurf abgelaufen.";
    case "stale":
      return "Kunde hat neu geschrieben, der Entwurf ist überholt.";
    case "not_pending":
      return "Bereits bearbeitet.";
    default:
      return "Senden fehlgeschlagen. Bitte erneut versuchen.";
  }
}

/**
 * Offener Entwurf des gewählten Gesprächs, über dem Eingabefeld. „Freigeben und
 * senden“ schickt ihn über die bestehende Freigabe (humanApproved), „Bearbeiten“
 * übernimmt den Text ins Feld (und meldet `taken`), „Verwerfen“ schließt ihn.
 * `aktualisierung` ändert sich mit jedem Neuladen der Akte und lädt den Entwurf neu.
 */
export function EntwurfKarte({
  gespraechId,
  aktualisierung,
  onUebernehmen,
  onGesendet,
}: {
  gespraechId: string | null;
  aktualisierung: unknown;
  onUebernehmen: (text: string) => void;
  onGesendet: () => Promise<void> | void;
}) {
  const [entwurf, setEntwurf] = useState<Entwurf | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    // Beim Kanalwechsel sofort leeren, sonst stünde der alte Entwurf kurz unter dem neuen Kanal.
    setEntwurf(null);
    setFehler(null);
    if (!gespraechId) return;
    let aktiv = true;
    void apiAufruf<{ draft: Entwurf | null }>(
      `/api/v1/agent-drafts?conversationId=${encodeURIComponent(gespraechId)}`
    ).then((r) => {
      if (!aktiv) return;
      setEntwurf(r.ok ? (r.data?.draft ?? null) : null);
      setFehler(null);
    });
    return () => {
      aktiv = false;
    };
  }, [gespraechId, aktualisierung]);

  if (!entwurf) return null;
  const e = entwurf;

  async function schliessen(action: "taken" | "dismiss") {
    // Der Vermerk ist nur Lernsignal; die Oberfläche hat die Aktion schon ausgeführt.
    await apiAufruf<unknown>(`/api/v1/agent-drafts/${e.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
  }

  function bearbeiten() {
    onUebernehmen(e.text);
    setEntwurf(null);
    void schliessen("taken");
  }

  async function verwerfen() {
    setEntwurf(null);
    await schliessen("dismiss");
  }

  async function freigeben() {
    if (laeuft) return;
    setLaeuft(true);
    setFehler(null);
    let res: Response;
    try {
      res = await fetch(`/api/v1/agent-drafts/${e.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve_and_send", finalText: e.text, humanApproved: true }),
      });
    } catch {
      setLaeuft(false);
      setFehler("Keine Verbindung zum Server.");
      return;
    }
    if (res.ok) {
      setEntwurf(null);
      setLaeuft(false);
      await onGesendet();
      return;
    }
    const j = (await res.json().catch(() => null)) as { error?: unknown; reasons?: string[]; detail?: string } | null;
    const wort = typeof j?.error === "string" ? j.error : undefined;
    setFehler(freigabeFehler(wort, j?.reasons, j?.detail));
    if (wort === "send_uncertain") setEntwurf({ ...e, uncertain: true });
    if (wort === "expired" || wort === "stale" || wort === "not_pending") {
      window.setTimeout(() => setEntwurf((d) => (d?.id === e.id ? null : d)), 1800);
    }
    setLaeuft(false);
  }

  return (
    <section className="akte-gespraech-entwurf" aria-label="Offener Entwurf">
      <div className="akte-gespraech-entwurf-kopf">
        <i className="akte-gespraech-punkt" aria-hidden="true" />
        <span>Entwurf · {KLASSE_LABEL[e.messageClass] ?? e.messageClass}</span>
        {e.uncertain ? <span className="akte-gespraech-entwurf-warnung">Zustellung unklar</span> : null}
        {e.priceFlag ? <span className="akte-gespraech-entwurf-warnung">Preis oder Zusage im Text</span> : null}
      </div>
      <p className="akte-gespraech-entwurf-text">{e.text}</p>
      <div className="akte-gespraech-entwurf-knoepfe">
        {!e.uncertain ? (
          <GlassButton size="sm" onClick={() => void freigeben()} disabled={laeuft}>
            {laeuft ? "Sendet…" : "Freigeben und senden"}
          </GlassButton>
        ) : null}
        <GlassButton size="sm" variant="soft" onClick={bearbeiten} disabled={laeuft}>
          Bearbeiten
        </GlassButton>
        <GlassButton size="sm" variant="ghost" onClick={() => void verwerfen()} disabled={laeuft}>
          Verwerfen
        </GlassButton>
      </div>
      {fehler ? (
        <p className="akte-gespraech-fehler" role="alert">
          {fehler}
        </p>
      ) : null}
    </section>
  );
}

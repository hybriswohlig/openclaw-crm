"use client";

import { useEffect, useRef, useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import { apiAufruf, jsonAufruf } from "./api";
import { freigabeFehler } from "./gespraech-texte";

export { freigabeFehler };

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

/**
 * Offener Entwurf des gewählten Gesprächs, über dem Eingabefeld. „Freigeben und
 * senden“ schickt ihn über die bestehende Freigabe (humanApproved), „Bearbeiten“
 * übernimmt den Text ins Feld (und meldet `taken`), „Verwerfen“ schließt ihn.
 * `aktualisierung` ändert sich mit jedem Neuladen der Akte und lädt den Entwurf
 * neu. `fensterZu`: das gewählte WABA-Gespräch ist außerhalb des Fensters, die
 * Freigabe würde am Gate scheitern und bleibt gesperrt.
 */
export function EntwurfKarte({
  gespraechId,
  aktualisierung,
  fensterZu,
  onUebernehmen,
  onGesendet,
}: {
  gespraechId: string | null;
  aktualisierung: unknown;
  fensterZu: boolean;
  onUebernehmen: (text: string) => void;
  onGesendet: () => Promise<unknown> | void;
}) {
  const [entwurf, setEntwurf] = useState<Entwurf | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  // Ein zweiter Klick während Freigeben oder Verwerfen darf nichts auslösen.
  const laeuftRef = useRef(false);

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

  function beginnen(): boolean {
    if (laeuftRef.current) return false;
    laeuftRef.current = true;
    setLaeuft(true);
    setFehler(null);
    return true;
  }

  function beenden() {
    laeuftRef.current = false;
    setLaeuft(false);
  }

  function bearbeiten() {
    onUebernehmen(e.text);
    setEntwurf(null);
    // Nur Lernsignal: die Oberfläche hat den Text schon übernommen, ein Fehler bleibt ohne Folge.
    void apiAufruf<unknown>(`/api/v1/agent-drafts/${e.id}`, jsonAufruf("PATCH", { action: "taken" }));
  }

  async function verwerfen() {
    if (!beginnen()) return;
    const r = await apiAufruf<unknown>(`/api/v1/agent-drafts/${e.id}`, jsonAufruf("PATCH", { action: "dismiss" }));
    beenden();
    if (!r.ok) {
      // Die Karte bleibt stehen, der Entwurf ist ja noch offen.
      setFehler(`Verwerfen fehlgeschlagen. ${r.message}`);
      return;
    }
    setEntwurf(null);
  }

  async function freigeben() {
    if (fensterZu || !beginnen()) return;
    let res: Response;
    try {
      res = await fetch(`/api/v1/agent-drafts/${e.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve_and_send", finalText: e.text, humanApproved: true }),
      });
    } catch {
      beenden();
      setFehler("Keine Verbindung zum Server.");
      return;
    }
    if (res.ok) {
      setEntwurf(null);
      beenden();
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
    beenden();
    // Das Fenster ist zu: die Akte neu laden, damit Sperre und Hinweis sofort stimmen.
    if (wort === "session_expired") await onGesendet();
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
          <GlassButton size="sm" onClick={() => void freigeben()} disabled={laeuft || fensterZu}>
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
      {fensterZu && !e.uncertain ? (
        <p className="akte-gespraech-hinweis akte-gespraech-entwurf-hinweis">
          24-Stunden-Fenster zu. Freigeben geht erst wieder, wenn der Kunde schreibt oder nach einer Vorlage.
        </p>
      ) : null}
      {fehler ? (
        <p className="akte-gespraech-fehler" role="alert">
          {fehler}
        </p>
      ) : null}
    </section>
  );
}

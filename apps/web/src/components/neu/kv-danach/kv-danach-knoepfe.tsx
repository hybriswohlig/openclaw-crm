"use client";

import "@/styles/neu-kv-danach.css";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { kvChatUrl, linkVerwaltenUrl, PORTAL_EINSTELLUNGEN_URL, statusLinkMeldung } from "@/lib/kv-danach";
import { statusLinkHolen, textKopieren } from "./status-link";

/**
 * Nächster Schritt nach dem KV (Auftrag kv-danach): „Statuslink kopieren“ und
 * „Im Chat senden“. Kopieren holt den Kunden-Link des Deals (fehlt er, wird er
 * angelegt; gesperrt bleibt gesperrt) und funktioniert für sich, auch wenn der
 * Chat nicht geht. „Im Chat senden“ öffnet die neue Inbox im Eintrag des Deals;
 * dort steht der Kurztext im Eingabefeld, gesendet wird nie von selbst.
 *
 * `klasse` gibt den Knöpfen das Aussehen des Ortes (Kalkulation, Akte, Meldung
 * unten rechts).
 */
export function KvDanachKnoepfe({
  dealId,
  klasse,
  gruppeKlasse,
  ohneChat = false,
}: {
  dealId: string;
  klasse: string;
  gruppeKlasse?: string;
  /** Nur „Statuslink kopieren“ (etwa ohne neue Inbox). */
  ohneChat?: boolean;
}) {
  const [laeuft, setLaeuft] = useState(false);
  const [kopiert, setKopiert] = useState(false);

  async function kopieren() {
    if (laeuft) return;
    setLaeuft(true);
    try {
      const lauf = statusLinkHolen(dealId);
      const ok = await textKopieren(lauf.then((l) => (l.art === "ok" ? l.url : null)));
      const l = await lauf;
      if (l.art === "ok") {
        if (ok) {
          setKopiert(true);
          window.setTimeout(() => setKopiert(false), 1500);
          toast.success(l.neu ? "Statuslink angelegt und kopiert." : "Statuslink kopiert.", { description: l.url });
        } else {
          // Ohne Zwischenablage (Rechte, alter Browser): den Link zum Markieren zeigen.
          toast.message("Statuslink", { description: `${l.url} · Kopieren ging nicht, bitte markieren.`, duration: 20_000 });
        }
        return;
      }
      const m = statusLinkMeldung(l);
      const ziel = l.art === "gesperrt" ? linkVerwaltenUrl(dealId) : l.art === "portal_aus" ? PORTAL_EINSTELLUNGEN_URL : null;
      toast.error(m.titel, {
        description: m.text,
        action: ziel
          ? { label: l.art === "gesperrt" ? "Alte Akte öffnen" : "Einstellungen", onClick: () => window.location.assign(ziel) }
          : undefined,
      });
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <span className={gruppeKlasse} role="group" aria-label="Nach dem KV">
      <button type="button" className={klasse} onClick={() => void kopieren()} disabled={laeuft} aria-busy={laeuft || undefined}>
        {laeuft ? "Holt den Link …" : kopiert ? "Kopiert" : "Statuslink kopieren"}
      </button>
      {ohneChat ? null : (
        <Link className={klasse} href={kvChatUrl(dealId)}>
          Im Chat senden
        </Link>
      )}
    </span>
  );
}

"use client";

import "@/styles/neu-banner.css";

import Link from "next/link";
import { GlassButton } from "@/components/glassyui/glass-button";
import { WHATSAPP_BANNER_LINK, WHATSAPP_BANNER_TEXT, useWhatsappStatus } from "@/components/layout/whatsapp-status-banner";
import { usePushPrompt } from "@/components/pwa/push-prompt-banner";

function Schliessen({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="neu-banner-zu" onClick={onClick} aria-label={label}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}

/**
 * Die beiden Banner der alten Shell im neuen Look (Plan 6, Entscheidung 16):
 * WhatsApp getrennt (rot, mit „Jetzt verbinden“) und Push-Freigabe
 * („Aktivieren“ / „Später“, auf iOS im Safari-Tab der Hinweis zum
 * Home-Bildschirm). Logik und Texte kommen aus den bestehenden Komponenten;
 * nur die Hülle ist neu.
 */
export function ShellBanner() {
  return (
    <>
      <WhatsappBanner />
      <PushBanner />
    </>
  );
}

function WhatsappBanner() {
  const { sichtbar, schliessen } = useWhatsappStatus();
  if (!sichtbar) return null;
  return (
    <div role="alert" className="neu-banner" data-ton="rot">
      <p className="neu-banner-text">{WHATSAPP_BANNER_TEXT}</p>
      <Link href={WHATSAPP_BANNER_LINK.href} className="neu-banner-link">
        {WHATSAPP_BANNER_LINK.text}
      </Link>
      <Schliessen onClick={schliessen} label="Hinweis schließen" />
    </div>
  );
}

function PushBanner() {
  const { sichtbar, iosHinweis, beschaeftigt, aktivieren, spaeter } = usePushPrompt();
  if (!sichtbar) return null;
  return (
    <div className="neu-banner" data-ton="hinweis" role="status">
      <span className="neu-banner-zeichen" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0" />
        </svg>
      </span>
      <div className="neu-banner-inhalt">
        {iosHinweis ? (
          <>
            <p className="neu-banner-titel">Push-Mitteilungen bei neuen Nachrichten</p>
            <p className="neu-banner-text">
              Tippe in Safari auf <b>Teilen</b> → <b>Zum Home-Bildschirm</b>, öffne die App von dort und du kannst sofort
              Mitteilungen aktivieren.
            </p>
          </>
        ) : (
          <>
            <p className="neu-banner-titel">Push-Mitteilungen aktivieren</p>
            <p className="neu-banner-text">
              Bekomme eine Mitteilung, sobald ein Kunde schreibt, auch wenn die App geschlossen ist.
            </p>
            <div className="neu-banner-knoepfe">
              <GlassButton size="sm" onClick={() => void aktivieren()} disabled={beschaeftigt}>
                {beschaeftigt ? "Aktiviert…" : "Aktivieren"}
              </GlassButton>
              <GlassButton size="sm" variant="ghost" onClick={spaeter} disabled={beschaeftigt}>
                Später
              </GlassButton>
            </div>
          </>
        )}
      </div>
      <Schliessen onClick={spaeter} label="Schließen" />
    </div>
  );
}

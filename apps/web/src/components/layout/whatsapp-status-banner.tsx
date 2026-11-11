"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import {
  BAILEYS_REPAIR_EVENT,
  baileysRepairHref,
  handleBaileysRepairClick,
  isInhouseBaileysDown,
} from "@/lib/baileys-repair";

interface ChannelAccount {
  id: string;
  channelType: "email" | "whatsapp";
  isActive: boolean;
  baileysBridgeProvider: "openclaw" | "inhouse" | null;
  baileysPairingStatus: string | null;
  baileysLastSeenAt: string | null;
}

const DISMISS_KEY = "kottke.whatsapp.banner.dismissed";

export const WHATSAPP_BANNER_TEXT = "WhatsApp ist nicht verbunden. Eingehende Kundennachrichten kommen derzeit nicht an.";
export const WHATSAPP_BANNER_LINK = { href: "/integrations", text: "Jetzt verbinden" } as const;

/**
 * Open the re-pair flow. On any page other than /integrations the real link
 * navigates (and the query tells the page which account to open). On
 * /integrations itself a Next.js <Link> to the same route is a no-op, so the
 * click is handled here.
 */
export function activateBaileysRepairLink(
  event: { preventDefault(): void; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; button?: number },
  href: string,
): void {
  const decision = handleBaileysRepairClick({
    pathname: window.location.pathname,
    href,
    modified: Boolean(event.metaKey || event.ctrlKey || event.altKey || (event.button && event.button !== 0)),
  });
  if (!decision.preventDefault || !decision.target) return;
  event.preventDefault();
  const url = new URL(href, window.location.origin);
  window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(
    new CustomEvent(BAILEYS_REPAIR_EVENT, { detail: { target: decision.target } }),
  );
}

/**
 * Zustand des WhatsApp-Banners, geteilt von der alten Shell und der neuen
 * (Plan 6, Entscheidung 16): pollt die Kanalkonten alle 90 s; `sichtbar`,
 * wenn ein Baileys-inhouse-Konto nicht aktiv und verbunden ist und dieser
 * Vorfall nicht weggeklickt wurde (je Vorfall, sessionStorage).
 */
export function useWhatsappStatus(): {
  sichtbar: boolean;
  schliessen: () => void;
  href: string;
} {
  const [incident, setIncident] = useState<string | null>(null);
  const [href, setHref] = useState<string>(WHATSAPP_BANNER_LINK.href);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY));
    } catch {
      // private mode etc. — ignore
    }

    async function load() {
      try {
        const res = await fetch("/api/v1/inbox/channel-accounts");
        if (!res.ok) return;
        const data = await res.json();
        const accounts: ChannelAccount[] = Array.isArray(data?.data)
          ? data.data
          : [];
        const down = accounts.filter(isInhouseBaileysDown);
        setHref(baileysRepairHref(down));
        setIncident(
          down.length
            ? down
                .map((a) => `${a.id}:${a.baileysLastSeenAt ?? "unbekannt"}`)
                .join("|")
            : null
        );
      } catch {
        // network blip — try again on the next tick
      }
    }
    load();
    const id = setInterval(load, 90000);
    return () => clearInterval(id);
  }, []);

  function schliessen() {
    if (!incident) return;
    try {
      sessionStorage.setItem(DISMISS_KEY, incident);
    } catch {
      // ignore
    }
    setDismissed(incident);
  }

  return { sichtbar: Boolean(incident) && incident !== dismissed, schliessen, href };
}

export function WhatsappStatusBanner() {
  const { sichtbar, schliessen, href } = useWhatsappStatus();

  if (!sichtbar) return null;

  return (
    <div
      role="alert"
      className="flex items-center gap-3 px-4 py-2 text-[13px]"
      style={{ background: "#b3261e", color: "#fff" }}
    >
      <span className="min-w-0 flex-1 truncate">
        {WHATSAPP_BANNER_TEXT}
      </span>
      <Link
        href={href}
        onClick={(event) => activateBaileysRepairLink(event, href)}
        className="relative z-10 inline-flex min-h-11 shrink-0 items-center px-1 underline underline-offset-2 touch-manipulation"
        style={{ fontWeight: 600, color: "#fff" }}
      >
        {WHATSAPP_BANNER_LINK.text}
      </Link>
      <button
        type="button"
        onClick={schliessen}
        aria-label="Hinweis schließen"
        className="shrink-0 rounded-md p-1 hover:bg-white/15"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

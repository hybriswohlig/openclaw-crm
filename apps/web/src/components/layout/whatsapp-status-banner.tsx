"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";

interface ChannelAccount {
  id: string;
  channelType: "email" | "whatsapp";
  isActive: boolean;
  baileysBridgeProvider: "openclaw" | "inhouse" | null;
  baileysPairingStatus: string | null;
  baileysLastSeenAt: string | null;
}

const DISMISS_KEY = "kottke.whatsapp.banner.dismissed";

export function WhatsappStatusBanner() {
  const [incident, setIncident] = useState<string | null>(null);
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
        const down = accounts.filter(
          (a) =>
            a.channelType === "whatsapp" &&
            a.baileysBridgeProvider === "inhouse" &&
            !(a.isActive && a.baileysPairingStatus === "connected")
        );
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

  if (!incident || incident === dismissed) return null;

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISS_KEY, incident!);
    } catch {
      // ignore
    }
    setDismissed(incident);
  }

  return (
    <div
      role="alert"
      className="flex items-center gap-3 px-4 py-2 text-[13px]"
      style={{ background: "#b3261e", color: "#fff" }}
    >
      <span className="min-w-0 flex-1 truncate">
        WhatsApp ist nicht verbunden. Eingehende Kundennachrichten kommen
        derzeit nicht an.
      </span>
      <Link
        href="/integrations"
        className="shrink-0 underline underline-offset-2"
        style={{ fontWeight: 600, color: "#fff" }}
      >
        Jetzt verbinden
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Hinweis schließen"
        className="shrink-0 rounded-md p-1 hover:bg-white/15"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

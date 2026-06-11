"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const pathname = usePathname();
  // Portal-Seiten haben unterhalb lg eine fixe Kauf-Leiste am unteren Rand.
  const isPortal = pathname?.startsWith("/s/") ?? false;

  useEffect(() => {
    const consent = localStorage.getItem("cookie-consent");
    if (!consent) {
      setVisible(true);
    }
  }, []);

  function handleAccept() {
    localStorage.setItem("cookie-consent", "accepted");
    setVisible(false);
    window.dispatchEvent(new Event("cookie-consent-update"));
  }

  function handleDecline() {
    localStorage.setItem("cookie-consent", "declined");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      className={`fixed ${isPortal ? "bottom-24 lg:bottom-4" : "bottom-4"} left-4 right-4 z-50 mx-auto max-w-md animate-in slide-in-from-bottom-4 fade-in duration-300`}
    >
      <div className="rounded-2xl border border-foreground/[0.08] dark:border-white/[0.08] bg-background/95 dark:bg-[#141416]/95 backdrop-blur-xl px-5 py-4 shadow-[0_8px_30px_-4px_rgba(0,0,0,0.15)] dark:shadow-[0_8px_30px_-4px_rgba(0,0,0,0.5)]">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Wir verwenden Cookies, um zu verstehen, wie diese Seite genutzt wird.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={handleAccept}
            className="rounded-full bg-foreground px-4 py-1.5 text-[12px] font-medium text-background transition-opacity hover:opacity-80"
          >
            Akzeptieren
          </button>
          <button
            onClick={handleDecline}
            className="rounded-full border border-foreground/10 dark:border-white/10 px-4 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/20 dark:hover:border-white/20"
          >
            Ablehnen
          </button>
        </div>
      </div>
    </div>
  );
}

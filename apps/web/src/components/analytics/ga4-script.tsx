"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { usePathname } from "next/navigation";
import { istPortalPfad } from "@/lib/portal-pfad";
import { GA4_ADRESSEN_SKRIPT } from "@/lib/analytics-url";

const GA4_ID = "G-SFDKGVNMS4";

export function GA4Script() {
  const [hasConsent, setHasConsent] = useState(false);
  const pathname = usePathname();
  const aktiv = hasConsent && !istPortalPfad(pathname);
  const letzteAdresse = useRef<string | null>(null);

  useEffect(() => {
    const consent = localStorage.getItem("cookie-consent");
    setHasConsent(consent === "accepted");

    const handleConsent = () => {
      const updated = localStorage.getItem("cookie-consent");
      setHasConsent(updated === "accepted");
    };

    window.addEventListener("cookie-consent-update", handleConsent);
    return () =>
      window.removeEventListener("cookie-consent-update", handleConsent);
  }, []);

  // Seitenwechsel im Browser: Ereignisse (scroll, user_engagement, eigene)
  // melden die neue Seite ohne Abfrage, Referrer ist die vorige Seite.
  useEffect(() => {
    if (!aktiv) return;
    const adresse = window.location.origin + window.location.pathname;
    const vorher = letzteAdresse.current;
    letzteAdresse.current = adresse;
    if (vorher && vorher !== adresse) {
      window.gtag?.("set", { page_location: adresse, page_referrer: vorher });
    }
  }, [aktiv, pathname]);

  if (!aktiv) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`}
        strategy="afterInteractive"
      />
      {/* page_location und eigener Referrer ohne Abfrage und Anker (lead=<uuid>, q=…), siehe lib/analytics-url.ts */}
      <Script id="ga4-init" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());${GA4_ADRESSEN_SKRIPT}gtag('config','${GA4_ID}');`}
      </Script>
    </>
  );
}

"use client";

import { useEffect } from "react";
import Script from "next/script";
import { usePathname } from "next/navigation";
import { istPortalPfad } from "@/lib/portal-pfad";
import { plausibleOhneAbfrage, type PlausibleNutzlast } from "@/lib/analytics-url";

type PlausibleStub = ((...args: unknown[]) => void) & {
  q?: unknown[][];
  o?: Record<string, unknown>;
  l?: boolean;
  init?: (optionen?: Record<string, unknown>) => void;
};

/**
 * Plausible-Init (wie das offizielle Snippet: Warteschlange plus init, das
 * Skript übernimmt plausible.o beim Laden). transformRequest schickt die
 * Seitenadresse ohne Abfrage (lead=<uuid>, q=…), Referrer ebenso.
 */
function initialisierePlausible() {
  const w = window as unknown as { plausible?: PlausibleStub };
  if (w.plausible?.o || w.plausible?.l) return; // schon initialisiert
  const stub: PlausibleStub =
    w.plausible ??
    function (...args: unknown[]) {
      (stub.q = stub.q || []).push(args);
    };
  w.plausible = stub;
  stub.init =
    stub.init ||
    function (optionen) {
      stub.o = optionen || {};
    };
  stub.init({
    transformRequest: (nutzlast: PlausibleNutzlast) => plausibleOhneAbfrage(nutzlast, window.location.origin),
  });
}

export function PlausibleScript() {
  const pathname = usePathname();
  // Kundenportal: keine Reichweitenmessung, die URL enthält den Zugangs-Token.
  const aus = istPortalPfad(pathname);

  useEffect(() => {
    if (!aus) initialisierePlausible();
  }, [aus]);

  if (aus) return null;
  return (
    <Script
      src="https://plausible.io/js/pa-NgffR9Cmf65xp81wiCACc.js"
      strategy="afterInteractive"
    />
  );
}

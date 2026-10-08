"use client";

import { useEffect } from "react";
import * as amplitude from "@amplitude/analytics-browser";
import { istPortalPfad } from "@/lib/portal-pfad";
import { amplitudeOhneAbfrage, amplitudeSperre } from "@/lib/analytics-url";

const AMPLITUDE_API_KEY = process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY;

/** Einmal je Seite (Strict Mode ruft Effekte in der Entwicklung doppelt). */
let gestartet = false;

export function AmplitudeScript() {
  useEffect(() => {
    // Amplitude nur im CRM, nie im Kundenportal (Token in der URL, § 25 TDDDG).
    if (istPortalPfad(window.location.pathname)) return;
    if (AMPLITUDE_API_KEY && !gestartet) {
      gestartet = true;
      // Seitenadressen ohne Abfrage (lead=<uuid>, q=…): Die Anreicherung muss
      // hinter den eingebauten laufen und lässt sich deshalb erst nach init()
      // anmelden. Bis dahin hält die Sperre jedes Ereignis an.
      const sperre = amplitudeSperre();
      amplitude.add(sperre.plugin);
      void amplitude
        .init(AMPLITUDE_API_KEY, {
          autocapture: { elementInteractions: false },
        })
        .promise.then(() => amplitude.add(amplitudeOhneAbfrage()).promise)
        .finally(sperre.freigeben);
    }
  }, []);

  return null;
}

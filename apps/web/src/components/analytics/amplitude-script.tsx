"use client";

import { useEffect } from "react";
import * as amplitude from "@amplitude/analytics-browser";
import { istPortalPfad } from "@/lib/portal-pfad";

const AMPLITUDE_API_KEY = process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY;

export function AmplitudeScript() {
  useEffect(() => {
    // Amplitude nur im CRM, nie im Kundenportal (Token in der URL, § 25 TDDDG).
    if (istPortalPfad(window.location.pathname)) return;
    if (AMPLITUDE_API_KEY) {
      amplitude.init(AMPLITUDE_API_KEY, {
        autocapture: { elementInteractions: false },
      });
    }
  }, []);

  return null;
}

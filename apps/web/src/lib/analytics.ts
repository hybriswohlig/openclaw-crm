// Analytics utility: fires events to Plausible, GA4, and Amplitude

import * as amplitude from "@amplitude/analytics-browser";
import { istPortalPfad } from "./portal-pfad";

declare global {
  interface Window {
    plausible?: (
      event: string,
      options?: { props?: Record<string, string | number> }
    ) => void;
    gtag?: (...args: unknown[]) => void;
  }
}

export function trackEvent(
  name: string,
  props?: Record<string, string | number>
) {
  if (typeof window === "undefined") return;
  // Kundenportal: keine Events an Dritte.
  if (istPortalPfad(window.location.pathname)) return;

  // Plausible (always available, no consent needed)
  if (window.plausible) {
    window.plausible(name, props ? { props } : undefined);
  }

  // GA4 (only if consent was given and gtag loaded)
  if (window.gtag) {
    window.gtag("event", name, props);
  }

  // Amplitude nur im CRM, nie im Kundenportal.
  amplitude.track(name, props);
}

/** Missing settings fail closed so existing companies opt in deliberately. */
export function portalFeatures(settings?: {
  liveTrackingEnabled?: boolean | null;
  paymentsEnabled?: boolean | null;
} | null) {
  return {
    liveTracking: settings?.liveTrackingEnabled === true,
    payments: settings?.paymentsEnabled === true,
  };
}

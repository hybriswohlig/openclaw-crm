"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_PORTAL_LOCALE,
  PORTAL_LOCALE_COOKIE,
  isPortalLocale,
  translate,
  type PortalLocale,
} from "@openclaw-crm/customer-portal-core";

/**
 * Segment error boundary for the customer portal. Customers are not
 * technical, so no digest, no stack, just a calm card and a retry button.
 *
 * This renders *instead of* the page, so it sits outside PortalLocaleProvider
 * and has to read the language cookie itself. It starts in German and
 * corrects after mount rather than guessing during SSR, which would risk a
 * hydration mismatch on an error screen — the one place a second failure
 * would be most confusing.
 */
export default function PortalError({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [locale, setLocale] = useState<PortalLocale>(DEFAULT_PORTAL_LOCALE);

  useEffect(() => {
    const match = document.cookie
      .split("; ")
      .find((row) => row.startsWith(`${PORTAL_LOCALE_COOKIE}=`));
    const value = match?.split("=")[1];
    if (isPortalLocale(value)) setLocale(value);
  }, []);

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center px-6">
      <div className="w-full rounded-2xl border bg-card p-6 text-center">
        <h1 className="text-xl font-medium">
          {translate(locale, "notices.errorTitle")}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {translate(locale, "notices.errorBody")}
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-xl border text-sm font-medium"
        >
          {translate(locale, "notices.errorRetry")}
        </button>
      </div>
    </main>
  );
}

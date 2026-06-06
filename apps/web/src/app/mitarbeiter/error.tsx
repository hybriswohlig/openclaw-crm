"use client";

import { useEffect } from "react";

/**
 * Portal error boundary. Surfaces the real error message (Next hides it behind
 * a generic "Application error" otherwise) so we can see what is failing.
 */
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Also log to the console for the full stack.
    console.error("[portal] error:", error);
  }, [error]);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 px-4 py-10 text-center">
      <div className="w-full max-w-md space-y-3">
        <h1 className="text-lg font-semibold">Es ist ein Fehler aufgetreten</h1>
        <p className="rounded-xl border border-border bg-card p-3 text-left text-sm break-words">
          {error?.message || "Unbekannter Fehler"}
        </p>
        {error?.digest ? (
          <p className="text-xs text-muted-foreground">Code: {error.digest}</p>
        ) : null}
        <div className="flex justify-center gap-2 pt-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            Erneut versuchen
          </button>
          <a
            href="/login"
            className="inline-flex min-h-11 items-center rounded-xl border border-border px-4 text-sm font-medium"
          >
            Zur Anmeldung
          </a>
        </div>
      </div>
    </div>
  );
}

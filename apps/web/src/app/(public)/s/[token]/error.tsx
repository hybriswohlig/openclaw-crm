"use client";

/**
 * Segment error boundary for the customer portal. Customers are not
 * technical, so no digest, no stack, just a calm card and a retry button.
 */
export default function PortalError({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center px-6">
      <div className="w-full rounded-2xl border bg-card p-6 text-center">
        <h1 className="text-xl font-medium">Das hat gerade nicht geklappt.</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Bitte laden Sie die Seite neu. Ihre Daten sind nicht verloren
          gegangen.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-xl border text-sm font-medium"
        >
          Erneut versuchen
        </button>
      </div>
    </main>
  );
}

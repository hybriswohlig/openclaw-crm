"use client";

import { useEffect } from "react";

/**
 * Root-level error boundary. Replaces Next's generic "Application error" page,
 * shows the real message, and reports it to a server sink so we can read the
 * exact exception users hit on their own devices.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    try {
      fetch("/api/v1/diag/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          message: error?.message,
          stack: error?.stack,
          digest: error?.digest,
          url: typeof location !== "undefined" ? location.href : null,
          ua: typeof navigator !== "undefined" ? navigator.userAgent : null,
        }),
      }).catch(() => {});
    } catch {
      // best effort
    }
  }, [error]);

  return (
    <html lang="de">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "#fbf8f3", color: "#1a1713" }}>
        <div style={{ maxWidth: 520, margin: "0 auto", padding: 24 }}>
          <h1 style={{ fontSize: 18 }}>Es ist ein Fehler aufgetreten</h1>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontSize: 13,
              background: "#fff",
              border: "1px solid #e5e0d8",
              borderRadius: 10,
              padding: 12,
            }}
          >
            {error?.message || "Unbekannter Fehler"}
          </pre>
          {error?.digest ? (
            <p style={{ fontSize: 12, color: "#6b6358" }}>Code: {error.digest}</p>
          ) : null}
          <button
            onClick={reset}
            style={{
              marginTop: 8,
              padding: "10px 16px",
              borderRadius: 10,
              border: "none",
              background: "#1a1713",
              color: "#fff",
              fontWeight: 600,
            }}
          >
            Erneut versuchen
          </button>
        </div>
      </body>
    </html>
  );
}

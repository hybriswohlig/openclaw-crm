import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ihr Umzug · Status",
  description: "Live-Status, Angebot, Auftragsbestätigung und Rechnung Ihres Umzugs.",
  robots: { index: false, follow: false },
};

/**
 * Minimal, opinionated wrapper for the customer-facing portal. No app nav,
 * no Better Auth, no CRM chrome — just a clean, mobile-first canvas the
 * Stage 1-4 components can paint into.
 *
 * Lives behind the public route group `(public)`, which means it inherits
 * the root `<html>`/`<body>` but skips the dashboard sidebar entirely.
 */
export default function CustomerPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-svh bg-background text-foreground antialiased">
      {children}
    </div>
  );
}

import type { Metadata } from "next";
import "./portal.css";

/**
 * Defaults only. The page-level `generateMetadata` below in
 * `[token]/page.tsx` overrides title, description, openGraph and twitter
 * fields with per-firma values so the WhatsApp/iMessage link preview
 * shows the operating company's brand, not a CRM product name.
 *
 * The `robots: noindex` stays here so unauthenticated crawlers don't
 * follow tokens.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Minimal, opinionated wrapper for the customer-facing portal. No app nav,
 * no Better Auth, no CRM chrome — just a clean, mobile-first canvas the
 * Stage 1-4 components can paint into.
 *
 * The `kottke-portal` class swaps every Tailwind colour token (background,
 * foreground, primary, muted, …) for the Berlin Blue palette defined in
 * portal.css. The CRM dashboard keeps its warm-paper palette untouched.
 */
export default function CustomerPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="kottke-portal min-h-svh bg-background text-foreground antialiased">
      {children}
    </div>
  );
}

import type { Metadata, Viewport } from "next";
import "./portal.css";

/**
 * Overrides the root layout's viewport for the portal segment: customers
 * may pinch-zoom here (the CRM locks zoom for its app chrome), and the
 * browser UI tint follows the Berlin Blue palette from portal.css instead
 * of the CRM theme colours.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0b111b" },
  ],
};

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

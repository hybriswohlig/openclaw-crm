import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { PlausibleScript } from "@/components/analytics/plausible-script";
import { GA4Script } from "@/components/analytics/ga4-script";
import { AmplitudeScript } from "@/components/analytics/amplitude-script";
import { CookieConsent } from "@/components/analytics/cookie-consent";
import { baseUrl } from "@/lib/base-url";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: {
    default: "N&E CRM",
    template: "%s | N&E CRM",
  },
  description: "N&E Innovations CRM — BioTech leads, trade fairs, and customers across Europe and Asia.",
  metadataBase: new URL(baseUrl),
  openGraph: {
    title: "N&E CRM",
    description:
      "N&E Innovations CRM — BioTech leads, trade fairs, and customers across Europe and Asia.",
    siteName: "N&E CRM",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "N&E CRM",
    description:
      "N&E Innovations CRM — BioTech leads, trade fairs, and customers across Europe and Asia.",
  },
  ...(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? {
        verification: {
          google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
        },
      }
    : {}),
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <PlausibleScript />
        <GA4Script />
        <AmplitudeScript />
        <ThemeProvider>{children}</ThemeProvider>
        <CookieConsent />
      </body>
    </html>
  );
}

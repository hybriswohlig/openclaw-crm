import type { Metadata } from "next";
import { Inter, Fraunces, JetBrains_Mono } from "next/font/google";
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
  variable: "--font-inter",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  axes: ["opsz", "SOFT"],
  variable: "--font-fraunces",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "OpenCRM-Umzug",
    template: "%s | OpenCRM-Umzug",
  },
  description: "Customer relationship management — contacts, companies, deals, tasks, and notes.",
  metadataBase: new URL(baseUrl),
  openGraph: {
    title: "OpenCRM-Umzug",
    description:
      "Customer relationship management — contacts, companies, deals, tasks, and notes.",
    siteName: "OpenCRM-Umzug",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "OpenCRM-Umzug",
    description:
      "Customer relationship management — contacts, companies, deals, tasks, and notes.",
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
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${fraunces.variable} ${jetbrainsMono.variable}`}
    >
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

import type { Metadata, Viewport } from "next";
import { Inter, Fraunces, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { PlausibleScript } from "@/components/analytics/plausible-script";
import { GA4Script } from "@/components/analytics/ga4-script";
import { AmplitudeScript } from "@/components/analytics/amplitude-script";
import { CookieConsent } from "@/components/analytics/cookie-consent";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { baseUrl } from "@/lib/base-url";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Internal-team app — explicit "no accidental pinch-zoom" request.
  // Locks the layout at 1× so taps near the edge of the chat composer
  // and the bottom tab bar don't accidentally rescale the page.
  maximumScale: 1,
  minimumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf8f3" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1713" },
  ],
};

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
    default: "Umzug-Suite",
    template: "%s | Umzug-Suite",
  },
  description: "Operative Steuerung für Umzüge, Transporte und Auftragsabwicklung.",
  metadataBase: new URL(baseUrl),
  manifest: "/manifest.webmanifest",
  applicationName: "Umzug-Suite",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Umzug-Suite",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    title: "Umzug-Suite",
    description: "Operative Steuerung für Umzüge, Transporte und Auftragsabwicklung.",
    siteName: "Umzug-Suite",
    type: "website",
    locale: "de_DE",
  },
  twitter: {
    card: "summary_large_image",
    title: "Umzug-Suite",
    description: "Operative Steuerung für Umzüge, Transporte und Auftragsabwicklung.",
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
      lang="de"
      suppressHydrationWarning
      className={`${inter.variable} ${fraunces.variable} ${jetbrainsMono.variable}`}
    >
      <body className={inter.className}>
        <PlausibleScript />
        <GA4Script />
        <AmplitudeScript />
        <ServiceWorkerRegister />
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
        <CookieConsent />
      </body>
    </html>
  );
}

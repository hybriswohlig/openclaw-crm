import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kottke CRM",
    short_name: "Kottke",
    description: "Kottke Umzüge — Aufträge, Inbox und Crew auf einen Blick.",
    start_url: "/start",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // Seitenfarbe der neuen Oberfläche (NEU_THEMEFARBE.light); dunkel setzt die Schale per meta.
    background_color: "#faf9f7",
    theme_color: "#faf9f7",
    lang: "de",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

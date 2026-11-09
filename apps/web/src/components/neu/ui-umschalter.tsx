"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { mitAlt } from "@/lib/handy-links";
import type { UiVersion } from "@/lib/ui-version";

const ZIEL: Record<UiVersion, { label: string; pfad: string }> = {
  neu: { label: "Neue Oberfläche testen", pfad: "/app/heute" },
  alt: { label: "Zur alten Oberfläche", pfad: mitAlt("/home") },
};

/**
 * Speichert die gewählte Oberfläche für den Nutzer und springt dann hinüber.
 * Schlägt das Speichern fehl, bleibt die Seite stehen und ein Hinweis erscheint.
 */
export function UiUmschalter({
  ziel,
  className,
  style,
}: {
  ziel: UiVersion;
  className?: string;
  style?: CSSProperties;
}) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);

  async function umschalten() {
    setLaeuft(true);
    try {
      const res = await fetch("/api/v1/me/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uiVersion: ziel }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.push(ZIEL[ziel].pfad);
    } catch {
      toast.error("Umschalten hat nicht geklappt. Bitte noch einmal versuchen.");
      setLaeuft(false);
    }
  }

  return (
    <button
      type="button"
      onClick={umschalten}
      disabled={laeuft}
      aria-busy={laeuft}
      className={className}
      style={style}
    >
      {ZIEL[ziel].label}
    </button>
  );
}

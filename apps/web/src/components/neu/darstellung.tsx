"use client";

/**
 * Plan 14b, Task S: Darstellung der neuen Oberfläche (Entscheidungen 2 bis 4 und 10).
 *
 * - Quelle ist `user_settings.ansichten.darstellung` (Plan 13). Der Spiegel-Cookie
 *   `neu_darstellung` lässt `DARSTELLUNG_SKRIPT` im `<head>` das Theme vor dem ersten Bild setzen.
 * - `useDarstellung` liest Cookie und Gerät (live über `prefers-color-scheme`) und liefert das
 *   Theme, das die Schale an `GlassProvider` gibt. Nur der schreibt `data-lg-theme`.
 * - `DarstellungSync` gleicht nach dem Laden einmal mit der Datenbank ab und hält die
 *   Themenfarbe (`<meta name="theme-color">`) passend; beim Verlassen von /app kommt der
 *   alte Stand zurück.
 * Die Klasse `dark` (next-themes, Portal, alte Seiten) fasst hier nichts an.
 */

import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { apiAufruf, jsonAufruf } from "@/components/neu/akte/api";
import { DARSTELLUNG_COOKIE, cookieZeile, type DarstellungSpiegel, type LgTheme } from "@/lib/dunkel-abschaltung";
import { DARSTELLUNG_SCHLUESSEL, darstellungAus } from "@/lib/einstellungen-uebersicht";
import { abgleichNoetig, darstellungAusCookie, themeFarbe, themeFuer, type MetaStand } from "./darstellung-logik";

// ─── Zustand (einer je Tab) ────────────────────────────────────────────────

interface Stand {
  darstellung: DarstellungSpiegel;
  systemDunkel: boolean;
}

const DUNKEL_ABFRAGE = "(prefers-color-scheme: dark)";

let stand: Stand | null = null;
const hoerer = new Set<() => void>();
let abfrage: MediaQueryList | null = null;
/** Zählt eigene Wahlen; der Abgleich verwirft eine Antwort, die älter ist als die letzte Wahl. */
let wahlen = 0;

function lesen(): Stand {
  if (!stand) {
    stand = {
      darstellung: darstellungAusCookie(document.cookie) ?? "system",
      systemDunkel: window.matchMedia?.(DUNKEL_ABFRAGE).matches ?? false,
    };
  }
  return stand;
}

function melden() {
  for (const h of hoerer) h();
}

function aendern(teil: Partial<Stand>) {
  stand = { ...lesen(), ...teil };
  melden();
}

function geraetGeaendert(e: MediaQueryListEvent) {
  aendern({ systemDunkel: e.matches });
}

function abonnieren(h: () => void): () => void {
  if (hoerer.size === 0) {
    // Frisch lesen: der Cookie kann sich geändert haben, während niemand zuhörte.
    stand = null;
    abfrage = window.matchMedia?.(DUNKEL_ABFRAGE) ?? null;
    abfrage?.addEventListener("change", geraetGeaendert);
  }
  hoerer.add(h);
  return () => {
    hoerer.delete(h);
    if (hoerer.size === 0) {
      abfrage?.removeEventListener("change", geraetGeaendert);
      abfrage = null;
    }
  };
}

function cookieSchreiben(d: DarstellungSpiegel) {
  document.cookie = cookieZeile(DARSTELLUNG_COOKIE, d, window.location.protocol === "https:");
}

const keinAbo = () => () => {};

/** `false` im Server-Bild und beim Hydrieren, danach `true`. */
function useHydriert(): boolean {
  return useSyncExternalStore(
    keinAbo,
    () => true,
    () => false
  );
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

export function useDarstellung(): {
  darstellung: DarstellungSpiegel;
  theme: LgTheme;
  setzen(d: DarstellungSpiegel): Promise<void>;
} {
  const darstellung = useSyncExternalStore(
    abonnieren,
    () => lesen().darstellung,
    () => "system" as const
  );
  // Server-Bild „light“: beim Hydrieren schreibt niemand data-lg-theme (GlassProvider wartet
  // auf die Hydration, DarstellungSync ebenso), das Kopf-Skript hat es schon gesetzt.
  const theme = useSyncExternalStore(
    abonnieren,
    () => themeFuer(lesen().darstellung, lesen().systemDunkel),
    () => "light" as const
  );
  return { darstellung, theme, setzen: darstellungSetzen };
}

/**
 * Wirkt sofort (Cookie und Zustand), speichert dann. Schlägt das Speichern fehl, kommt der
 * alte Wert zurück und das Versprechen wird mit der Meldung des Servers abgelehnt.
 */
async function darstellungSetzen(d: DarstellungSpiegel): Promise<void> {
  const vorher = lesen().darstellung;
  wahlen += 1;
  cookieSchreiben(d);
  aendern({ darstellung: d });
  const r = await apiAufruf(`/api/v1/me/ansichten/${DARSTELLUNG_SCHLUESSEL}`, jsonAufruf("PUT", d));
  if (!r.ok) {
    cookieSchreiben(vorher);
    aendern({ darstellung: vorher });
    throw new Error(r.message);
  }
}

// ─── Abgleich und Themenfarbe ───────────────────────────────────────────────

export function DarstellungSync({ theme }: { theme: LgTheme }): null {
  const hydriert = useHydriert();

  // Einmal je Laden: anderes Gerät, Cookie fehlt oder ist veraltet.
  useEffect(() => {
    let aktiv = true;
    const wahlenBeimStart = wahlen;
    void (async () => {
      const r = await apiAufruf<{ ansichten?: Record<string, unknown> | null }>("/api/v1/me/settings");
      if (!aktiv || !r.ok) return;
      const ziel = abgleichNoetig(
        darstellungAusCookie(document.cookie),
        darstellungAus(r.data?.ansichten),
        wahlen !== wahlenBeimStart
      );
      if (!ziel) return;
      cookieSchreiben(ziel);
      if (ziel !== lesen().darstellung) aendern({ darstellung: ziel });
    })();
    return () => {
      aktiv = false;
    };
  }, []);

  // Nach einer Client-Navigation in /app hinein lief das Kopf-Skript nicht: das Theme vor dem
  // ersten Bild setzen (GlassProvider schreibt es erst im Effekt). Beim Hydrieren nichts tun,
  // sonst überschriebe das Server-Bild („light“) den Wert des Kopf-Skripts.
  useLayoutEffect(() => {
    if (hydriert) document.documentElement.setAttribute("data-lg-theme", theme);
  }, [hydriert, theme]);

  // Themenfarbe: ein Wert für beide Schemata, solange /app offen ist.
  useLayoutEffect(() => {
    if (!hydriert) return;
    const metas = [...document.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
    const vorher: MetaStand[] = metas.map((m) => ({ content: m.getAttribute("content"), media: m.getAttribute("media") }));
    let eigene: HTMLMetaElement | null = null;
    if (metas.length === 0) {
      eigene = document.createElement("meta");
      eigene.name = "theme-color";
      document.head.appendChild(eigene);
      metas.push(eigene);
    }
    for (const m of metas) {
      m.removeAttribute("media");
      m.setAttribute("content", themeFarbe(theme));
    }
    return () => {
      if (eigene) {
        eigene.remove();
        return;
      }
      metas.forEach((m, i) => {
        const v = vorher[i]!;
        if (v.content === null) m.removeAttribute("content");
        else m.setAttribute("content", v.content);
        if (v.media === null) m.removeAttribute("media");
        else m.setAttribute("media", v.media);
      });
    };
  }, [hydriert, theme]);

  return null;
}

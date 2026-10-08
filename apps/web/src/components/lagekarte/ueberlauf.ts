"use client";
/**
 * Lagekarte: Scroll-Leisten (Legende mobil, Kennzahlen im HUD) zeigen mit einer
 * Ausblendmaske, an welcher Seite noch Inhalt kommt.
 */
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

/**
 * Scroll-Leiste: welche Ränder haben noch versteckten Inhalt? Läuft nach jedem
 * Render (Chips kommen und gehen mit dem Filter), beim Scrollen und bei Größenänderung.
 */
export function useUeberlaufKanten(ref: RefObject<HTMLDivElement | null>, aktiv: boolean) {
  const [kanten, setKanten] = useState({ links: false, rechts: false });
  const messenRef = useRef<() => void>(() => undefined);
  messenRef.current = () => {
    const el = ref.current;
    if (!aktiv || !el) return;
    const links = el.scrollLeft > 1;
    const rechts = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setKanten((alt) => (alt.links === links && alt.rechts === rechts ? alt : { links, rechts }));
  };
  useEffect(() => {
    messenRef.current();
  });
  useEffect(() => {
    const el = ref.current;
    if (!aktiv || !el) return;
    const messen = () => messenRef.current();
    el.addEventListener("scroll", messen, { passive: true });
    const ro = new ResizeObserver(messen);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", messen);
      ro.disconnect();
    };
  }, [ref, aktiv]);
  return aktiv ? kanten : { links: false, rechts: false };
}

/** Ausblendmaske für die Ränder der Scroll-Leiste (Hinweis: hier geht es weiter). */
export function randMaske(links: boolean, rechts: boolean): CSSProperties | undefined {
  if (!links && !rechts) return undefined;
  const verlauf = `linear-gradient(to right, ${links ? "transparent 0, #000 28px" : "#000 0"}, ${
    rechts ? "#000 calc(100% - 28px), transparent 100%" : "#000 100%"
  })`;
  return { maskImage: verlauf, WebkitMaskImage: verlauf };
}

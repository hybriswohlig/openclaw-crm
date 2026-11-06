"use client";

import Link from "next/link";
import { GlassButton } from "@/components/glassyui/glass-button";
import { LAGEKARTE_LINK, planTagLink } from "./heute-logik";

/**
 * Kopf der Startseite (Entscheidung 11): „Heute“, darunter der Tag
 * („Freitag, 6. November“), rechts „Plan“ (Tagesansicht) und leise
 * „Lagekarte“ (die alte Startseite). Am Handy eine Unterzeile mit der Zahl
 * der Termine statt der großen zweiten Zeile.
 */
export function HeuteKopf({ tag, kopf, unterzeile, kompakt }: { tag: string; kopf: string; unterzeile: string; kompakt: boolean }) {
  const knoepfe = (
    <div className="heute-kopf-aktionen">
      <GlassButton size={kompakt ? "sm" : "md"} asChild>
        <Link href={planTagLink(tag)}>Plan</Link>
      </GlassButton>
      <GlassButton size={kompakt ? "sm" : "md"} variant="ghost" asChild>
        <Link href={LAGEKARTE_LINK}>Lagekarte</Link>
      </GlassButton>
    </div>
  );

  if (kompakt) {
    return (
      <header className="heute-kopf heute-kopf-handy">
        <div className="heute-kopf-text">
          <h1>Heute</h1>
          <p>{unterzeile}</p>
        </div>
        {knoepfe}
      </header>
    );
  }

  return (
    <header className="neu-kopf heute-kopf">
      <div className="heute-kopf-text">
        <h1>Heute</h1>
        <p className="neu-kopf-zweite">{kopf}</p>
      </div>
      {knoepfe}
    </header>
  );
}

"use client";

import type { ReactNode } from "react";
import type { Herkunft } from "@/lib/kalkulation-versionen";
import type { GrundlageAnsichtZeile } from "@/lib/kalkulations-ansicht";

export type MarkenTon = "violett" | "jade" | "blau" | "gold" | "grau";

/** Herkunftsmarken (Spec 3.6): FOTO violett, CHAT jade, KUNDE/GOOGLE blau, Name gold, REGEL/STANDARD grau. */
export function tonFuer(art: Herkunft | "BOT"): MarkenTon {
  switch (art) {
    case "FOTO":
      return "violett";
    case "CHAT":
      return "jade";
    case "KUNDE":
    case "GOOGLE":
      return "blau";
    case "MANUELL":
      return "gold";
    default:
      return "grau";
  }
}

export function Herkunftsmarke({ art, text }: { art: Herkunft | "BOT"; text: string }) {
  return (
    <span className="kalk-marke" data-ton={tonFuer(art)} title={art === "MANUELL" ? `Von Hand gesetzt: ${text}` : undefined}>
      {text}
    </span>
  );
}

/** „Bearbeitet · 04.11. 10:48“ (`am` kommt vom Server als fertiger Text). */
export function bearbeitetText(am: string): string {
  return `Bearbeitet · ${am}`;
}

/**
 * Eine Zeile der Grundlage: Label, Wert, Herkunftsmarken mit der Warum-Zeile,
 * bei Übersteuerung gold umrandet mit „Bearbeitet · {am}“. Mit Feldern ist
 * der Inhalt ein Knopf (öffnet den Eingabe-Dialog); `children` (der
 * Street-View-Kasten) steht darunter in derselben Fläche, außerhalb des Knopfs.
 */
export function GrundlageZeile({
  zeile,
  beschaeftigt,
  onBearbeiten,
  children,
}: {
  zeile: GrundlageAnsichtZeile;
  beschaeftigt: boolean;
  onBearbeiten?: (zeile: GrundlageAnsichtZeile) => void;
  children?: ReactNode;
}) {
  const bearbeitbar = zeile.felder.length > 0 && onBearbeiten !== undefined;
  const inhalt = (
    <>
      <span className="kalk-zeile-k">{zeile.label}</span>
      <span className="kalk-zeile-v">{zeile.wert}</span>
      {zeile.herkunft.length > 0 || zeile.warum ? (
        <span className="kalk-zeile-warum">
          {zeile.herkunft.map((h, i) => (
            <Herkunftsmarke key={`${h.art}-${i}`} art={h.art} text={h.text} />
          ))}
          {zeile.warum ? <span>{zeile.warum}</span> : null}
        </span>
      ) : null}
      {zeile.bearbeitet ? (
        <span className="kalk-zeile-stift" title={`${zeile.bearbeitet.von}: ${zeile.bearbeitet.grund}`}>
          {bearbeitetText(zeile.bearbeitet.am)}
        </span>
      ) : null}
    </>
  );

  return (
    <div className="kalk-zeile" data-bearbeitet={zeile.bearbeitet ? "" : undefined} data-key={zeile.key}>
      {bearbeitbar ? (
        <button
          type="button"
          className="kalk-zeile-inhalt"
          disabled={beschaeftigt}
          onClick={() => onBearbeiten?.(zeile)}
          aria-label={`${zeile.label}: ${zeile.wert}, ändern`}
        >
          {inhalt}
        </button>
      ) : (
        <div className="kalk-zeile-inhalt">{inhalt}</div>
      )}
      {children}
    </div>
  );
}

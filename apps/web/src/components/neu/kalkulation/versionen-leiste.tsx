"use client";

import type { KalkulationsAnsicht } from "@/lib/kalkulations-ansicht";
import { euro } from "@/components/neu/akte/format";

type Version = KalkulationsAnsicht["versionen"][number];

/** „v1 · 2.390 €“, Entwurf ohne Preis „v3“. */
export function versionText(v: Pick<Version, "version" | "preisCent">): string {
  return v.preisCent === null ? `v${v.version}` : `v${v.version} · ${euro(v.preisCent)}`;
}

/**
 * Versionen als Kapseln (Spec 3.6): v1 · Betrag, v2 · Betrag, aktiv weiß, dazu
 * „+ Neue Version“, solange kein Entwurf da ist (sonst steht der Entwurf schon
 * als Kapsel). Während eines Laufs sind alle Kapseln gesperrt.
 */
export function VersionenLeiste({
  versionen,
  beschaeftigt,
  onWechsel,
  onNeueVersion,
}: {
  versionen: Version[];
  beschaeftigt: boolean;
  onWechsel: (version: number) => void;
  onNeueVersion: () => void;
}) {
  const hatEntwurf = versionen.some((v) => v.status === "entwurf");
  return (
    <div className="kalk-versionen" role="group" aria-label="Versionen">
      {versionen.map((v) => (
        <button
          key={v.version}
          type="button"
          className="kalk-version"
          aria-current={v.aktiv ? "true" : undefined}
          disabled={beschaeftigt}
          onClick={() => {
            if (!v.aktiv) onWechsel(v.version);
          }}
          title={v.status === "gesperrt" ? `Version ${v.version}, gesperrt` : `Version ${v.version}, Entwurf`}
        >
          {versionText(v)}
        </button>
      ))}
      {hatEntwurf ? null : (
        <button type="button" className="kalk-version" data-neu-version="" disabled={beschaeftigt} onClick={onNeueVersion}>
          + Neue Version
        </button>
      )}
    </div>
  );
}

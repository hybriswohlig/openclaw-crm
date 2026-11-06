"use client";

import Link from "next/link";
import type { KalkulationsAnsicht } from "@/lib/kalkulations-ansicht";
import { VersionenLeiste } from "./versionen-leiste";

/**
 * Kopf der Kalkulationsseite: Brotkrumen „‹ Akte {Name} · Schritt 3 von 11“,
 * „Kalkulation“ mit der zweiten Zeile vom Server (`kopf.unterzeile`), rechts
 * die Versionskapseln und die Sperrstatus-Pille („v2 gesperrt · gesendet …“
 * bzw. „v3 Entwurf“).
 */
export function KalkKopf({
  kopf,
  versionen,
  version,
  beschaeftigt,
  onWechsel,
  onNeueVersion,
}: {
  kopf: KalkulationsAnsicht["kopf"];
  versionen: KalkulationsAnsicht["versionen"];
  version: KalkulationsAnsicht["version"];
  beschaeftigt: boolean;
  onWechsel: (version: number) => void;
  onNeueVersion: () => void;
}) {
  const gesperrt = version.status === "gesperrt";
  const pille = gesperrt ? (version.gesperrtText ?? `v${version.nummer} gesperrt`) : `v${version.nummer} Entwurf`;
  return (
    <>
      <p className="kalk-krume">
        <Link href={kopf.aktenLink}>‹ Akte {kopf.name}</Link> · {kopf.schritt}
      </p>
      <header className="kalk-kopf">
        <div className="kalk-kopf-text">
          <h1 className="kalk-titel">Kalkulation</h1>
          {kopf.unterzeile ? <p className="kalk-unterzeile">{kopf.unterzeile}</p> : null}
        </div>
        <div className="kalk-kopf-rechts">
          <VersionenLeiste versionen={versionen} beschaeftigt={beschaeftigt} onWechsel={onWechsel} onNeueVersion={onNeueVersion} />
          <span className="kalk-pille" data-status={version.status}>
            <i className="kalk-punkt" data-ton={gesperrt ? "jade" : "blau"} aria-hidden="true" />
            {pille}
          </span>
        </div>
      </header>
    </>
  );
}

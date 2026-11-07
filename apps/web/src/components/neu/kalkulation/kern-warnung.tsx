"use client";

import type { KalkulationsAnsicht } from "@/lib/kalkulations-ansicht";
import { kernHinweis, type PreisStart } from "./preis-logik";

/**
 * Kern-Regel unter „So steht es im KV“ (Plan 5b, F13): nie automatisch
 * zusammenklappen. Kleiner Kern gold mit „Als ein Posten zeigen“, Kern ≤ 0
 * rose ohne Knopf, als ein Posten gezeigt blau mit „Wieder einzeln zeigen“.
 * Beide Knöpfe öffnen den Preis-Dialog (Anpassung `kv_darstellung` mit Grund).
 */
export function KernWarnung({
  kern,
  kvDarstellung,
  beschaeftigt,
  onPreis,
}: {
  kern: KalkulationsAnsicht["kern"];
  kvDarstellung: KalkulationsAnsicht["kvDarstellung"];
  beschaeftigt: boolean;
  onPreis: (start: PreisStart) => void;
}) {
  const h = kernHinweis(kern, kvDarstellung);
  if (!h) return null;
  return (
    <div className="kalk-kern" data-ton={h.ton} role="status">
      <span>{h.text}</span>
      {h.aktion && h.knopf ? (
        <button
          type="button"
          className="kalk-kleinknopf"
          disabled={beschaeftigt}
          onClick={() => onPreis({ art: "kv_darstellung", wert: h.aktion ?? undefined })}
        >
          {h.knopf}
        </button>
      ) : null}
    </div>
  );
}

"use client";

import Link from "next/link";
import type { KvEditorAnsicht, KvStandKopf } from "@/lib/kv-editor";
import { standAbzeichen } from "./kv-editor-logik";
import { SymbolPushen, SymbolSprechblase, SymbolStift, SymbolVerlauf } from "./kv-symbole";

export type RechtsPanel = "formular" | "chat" | null;

/**
 * Kopfleiste nach Skizze (Spec 10): links „Verlauf“, zurück zur Akte, „KV · Kunde“,
 * Abzeichen des gezeigten Stands, „Kalkulation vN“; rechts „Bearbeiten“, die Sprechblase
 * und bei fertigem Entwurf „Pushen“.
 */
export function KvKopf({
  ansicht,
  stand,
  verlaufOffen,
  rechts,
  pushSichtbar,
  bearbeitbar,
  beschaeftigt,
  onVerlauf,
  onRechts,
  onPushen,
}: {
  ansicht: KvEditorAnsicht;
  stand: KvStandKopf | null;
  verlaufOffen: boolean;
  rechts: RechtsPanel;
  pushSichtbar: boolean;
  /** Bearbeiten und Chat nur mit Stand. */
  bearbeitbar: boolean;
  beschaeftigt: boolean;
  onVerlauf: () => void;
  onRechts: (p: RechtsPanel) => void;
  onPushen: () => void;
}) {
  const abz = stand ? standAbzeichen(stand) : null;
  const akte = `/app/leads/${encodeURIComponent(ansicht.dealId)}`;
  return (
    <header className="kve-kopf">
      <div className="kve-kopf-links">
        <button
          type="button"
          className="kve-rund"
          aria-label="Verlauf"
          aria-expanded={verlaufOffen}
          aria-controls="kve-verlauf"
          data-an={verlaufOffen || undefined}
          disabled={!stand}
          onClick={onVerlauf}
        >
          <SymbolVerlauf />
          <span className="kve-rund-text">Verlauf</span>
        </button>
        <div className="kve-kopf-text">
          <p className="kve-krume">
            <Link href={akte}>‹ Akte</Link>
          </p>
          <h1 className="kve-titel">
            KV<span className="kve-titel-kunde"> · {ansicht.kunde ?? "ohne Namen"}</span>
          </h1>
        </div>
        <div className="kve-kopf-pillen">
          {stand && abz ? (
            <span className="kve-pille" data-ton={abz.ton}>
              <i className="kve-punkt" data-ton={abz.ton} aria-hidden="true" />
              Stand {stand.nummer} · {abz.text}
            </span>
          ) : null}
          {ansicht.kalkulationVersion !== null ? (
            <Link className="kve-pille kve-pille-link" href={ansicht.preis.kalkulationUrl}>
              Kalkulation v{ansicht.kalkulationVersion}
            </Link>
          ) : null}
        </div>
      </div>
      <div className="kve-kopf-rechts">
        <button
          type="button"
          className="kve-rund"
          aria-pressed={rechts === "formular"}
          data-an={rechts === "formular" || undefined}
          disabled={!bearbeitbar}
          onClick={() => onRechts(rechts === "formular" ? null : "formular")}
        >
          <SymbolStift />
          <span className="kve-rund-text">Bearbeiten</span>
        </button>
        <button
          type="button"
          className="kve-rund kve-blase"
          aria-label="KI-Chat"
          aria-pressed={rechts === "chat"}
          data-an={rechts === "chat" || undefined}
          disabled={!bearbeitbar}
          onClick={() => onRechts(rechts === "chat" ? null : "chat")}
        >
          <SymbolSprechblase />
        </button>
        {pushSichtbar ? (
          <button type="button" className="kve-push" disabled={beschaeftigt} onClick={onPushen}>
            <SymbolPushen />
            Pushen
          </button>
        ) : null}
      </div>
    </header>
  );
}

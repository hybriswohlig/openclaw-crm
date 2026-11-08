"use client";

import "@/styles/neu-akte-ablauf.css";

import Link from "next/link";
import { useId, useState } from "react";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { einsatzDialogOeffnen } from "@/components/neu/einsatz/einsatz-api";
import type { AblaufSchritt } from "@/lib/ablauf";
import type { AkteDaten } from "@/lib/akte";
import { fokusIndex, schrittOffen, sequenzRechts, WER_LABEL, ZUSTAND_TEXT } from "./ablauf-anzeige";
import { meldungBearbeiten } from "./zahlungsmeldung";

type Ablauf = AkteDaten["ablauf"];
type Zahlung = AkteDaten["zahlung"];

/**
 * Das Ablauf-Panel rechts in der Akte: die elf Schritte aus `/akte` mit
 * Kreis, Verbindungslinie, Wer-Marke, Zeile, Hinweis, Nachfass-Sequenz und
 * Chips (Maße aus dem Mockup). Aktionen: Schritt 3 öffnet die Kalkulation der
 * alten Seite (Entscheidung 3); Schritt 7 öffnet den Einsatz-Dialog (Plan 12a,
 * Entscheidung 10; der Empfänger hängt im Akte-Kopf); Schritt 10 bestätigt bei genau einer offenen
 * Meldung direkt (Entscheidung 6), sonst ruft er `onZahlung`; Schritt 11 ruft
 * `onBewertung`, aber nur mit `bewertungErlaubt` aus dem Dock (Stufe
 * Durchgeführt oder Bezahlt, noch nicht angefragt, nicht gesperrt). Unter
 * 640 px zeigt das Panel nur den Schritt `jetzt` und einen Knopf „Alle 11 Schritte“.
 */
export function AblaufPanel({
  dealId,
  ablauf,
  zahlung,
  kalkulationLink,
  bewertungErlaubt,
  onNeuLaden,
  onZahlung,
  onBewertung,
}: {
  dealId: string;
  ablauf: Ablauf;
  zahlung: Zahlung;
  kalkulationLink: string;
  bewertungErlaubt: boolean;
  onNeuLaden: () => Promise<void> | void;
  onZahlung?: () => void;
  onBewertung?: () => void;
}) {
  const [alle, setAlle] = useState(false);
  const [bestaetigt, setBestaetigt] = useState<string | null>(null);
  const listeId = useId();
  const fokus = fokusIndex(ablauf.schritte);
  const anzahl = ablauf.schritte.length;

  /** Bestätigen und Neuladen wie in Dock und Zahlungsdialog (`zahlungsmeldung.ts`). */
  async function bestaetigen(eventId: string) {
    setBestaetigt(eventId);
    const { neuLaden } = await meldungBearbeiten(dealId, eventId, "bestaetigen");
    if (neuLaden) await onNeuLaden();
    setBestaetigt(null);
  }

  return (
    <GlassPanel variant="panel" className="akte-panel akte-ablauf-panel">
      <div className="akte-panel-kopf">
        <div>
          <h2 className="akte-panel-titel">Ablauf</h2>
          <p className="akte-panel-unter">Von der Anfrage bis zur Bewertung.</p>
        </div>
        <span className="akte-panel-rechts">
          {ablauf.position} von {anzahl}
        </span>
      </div>
      <ol id={listeId} className="akte-ablauf-liste" data-alle={alle || undefined} aria-label="Schritte">
        {ablauf.schritte.map((s, i) => {
          // Schritt 10: bei genau einer offenen Meldung steht „Bestätigen“ im Hinweis,
          // sonst „Zahlung erfassen“ unter dem Schritt (Entscheidung 6).
          const einzige = s.key === "zahlung" && s.hinweis && zahlung.meldungen.length === 1 ? zahlung.meldungen[0] : null;
          const laeuft = einzige !== null && bestaetigt === einzige.eventId;
          return (
            <Schritt
              key={s.key}
              schritt={s}
              fokus={i === fokus}
              hinweisKnopf={
                einzige ? (
                  <button
                    type="button"
                    className="akte-ablauf-knopf"
                    disabled={laeuft}
                    aria-busy={laeuft || undefined}
                    onClick={() => void bestaetigen(einzige.eventId)}
                  >
                    {laeuft ? "Bestätigt …" : "Bestätigen"}
                  </button>
                ) : null
              }
            >
              {s.key === "kalkulation" && s.zustand !== "entfaellt" ? (
                <Link href={kalkulationLink} className="akte-ablauf-knopf">
                  Kalkulation öffnen
                </Link>
              ) : null}
              {s.key === "einsatz" && s.zustand !== "entfaellt" ? (
                <button type="button" className="akte-ablauf-knopf" onClick={() => einsatzDialogOeffnen(dealId)}>
                  {s.zustand === "erledigt" ? "Einsatz ändern" : "Einsatz planen"}
                </button>
              ) : null}
              {s.key === "zahlung" && !einzige && schrittOffen(s.zustand) && onZahlung ? (
                <button type="button" className="akte-ablauf-knopf" onClick={onZahlung}>
                  Zahlung erfassen
                </button>
              ) : null}
              {s.key === "bewertung" && schrittOffen(s.zustand) && bewertungErlaubt && onBewertung ? (
                <button type="button" className="akte-ablauf-knopf" onClick={onBewertung}>
                  Bewertung anfragen
                </button>
              ) : null}
            </Schritt>
          );
        })}
      </ol>
      <button
        type="button"
        className="akte-ablauf-alle"
        aria-expanded={alle}
        aria-controls={listeId}
        onClick={() => setAlle((a) => !a)}
      >
        {alle ? "Nur den aktuellen Schritt" : `Alle ${anzahl} Schritte`}
      </button>
    </GlassPanel>
  );
}

/**
 * Ein Schritt: Kreis (jade „✓“, blau mit Ring, Nummer auf `--fill-3`, grau
 * bei entfällt), Titel mit Wer-Marke, Zeile, Hinweis (mit `hinweisKnopf`
 * darin), Sequenz, Chips, dann die Aktion des Aufrufers (`children`).
 */
function Schritt({
  schritt: s,
  fokus,
  hinweisKnopf,
  children,
}: {
  schritt: AblaufSchritt;
  fokus: boolean;
  hinweisKnopf?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <li
      className="akte-schritt"
      data-zustand={s.zustand}
      data-fokus={fokus || undefined}
      aria-current={s.zustand === "jetzt" ? "step" : undefined}
    >
      <span className="akte-schritt-kreis" aria-hidden="true">
        {s.zustand === "erledigt" ? "✓" : s.nr}
      </span>
      <div className="akte-schritt-text">
        <div className="akte-schritt-titel">
          <span className="akte-schritt-name">{s.titel}</span>
          {s.wer ? (
            <span className="akte-wer" data-wer={s.wer}>
              {WER_LABEL[s.wer]}
            </span>
          ) : null}
          <span className="sr-only">, {ZUSTAND_TEXT[s.zustand]}</span>
        </div>
        {s.zeile ? <div className="akte-schritt-zeile">{s.zeile}</div> : null}
        {s.hinweis ? (
          <Hinweis ton={s.hinweis.ton} text={s.hinweis.text}>
            {hinweisKnopf}
          </Hinweis>
        ) : null}
        {s.sequenz && s.sequenz.length > 0 ? (
          <div className="akte-sequenz" aria-label="Nachfass-Sequenz">
            {s.sequenz.map((e) => (
              <div key={e.tag} className="akte-sequenz-zeile">
                <span>
                  Tag {e.tag} · {e.text}
                </span>
                <b>{sequenzRechts(e)}</b>
              </div>
            ))}
          </div>
        ) : null}
        {s.chips && s.chips.length > 0 ? (
          <div className="akte-chips">
            {s.chips.map((c) => (
              <span key={c} className="akte-chip">
                {c}
              </span>
            ))}
          </div>
        ) : null}
        {children}
      </div>
    </li>
  );
}

function Hinweis({ ton, text, children }: { ton: "gold" | "blau"; text: string; children?: React.ReactNode }) {
  return (
    <div className="akte-ablauf-hinweis" data-ton={ton}>
      <i aria-hidden="true" />
      <span>{text}</span>
      {children}
    </div>
  );
}


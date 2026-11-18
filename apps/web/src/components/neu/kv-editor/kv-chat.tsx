"use client";

import { useEffect, useId, useRef, useState } from "react";
import { KV_ABSCHNITT_TITEL, type KvFeld } from "@/lib/kv-editor";
import { feldTitel, zeitText } from "./kv-editor-logik";
import { ablehnungZeilen, KV_CHAT_MAX, sendbar, startAuswahl, uebernehmbar, type ChatEintrag } from "./kv-chat-logik";
import { wertText } from "./kv-formular-logik";
import { SymbolSchliessen, SymbolSenden } from "./kv-symbole";

/**
 * Chatfeld rechts (Skizze, Spec 8, 10): Verlauf der Beiträge, KI-Antworten mit
 * Vorschlagskarte (alt → neu, abhaken) und „Übernehmen (n)“. Übernehmen speichert
 * einen neuen Stand mit `kiNachrichtId`; die KI ändert nie den Preis.
 */
export function KvChat({
  eintraege,
  felder,
  firma,
  jetzt,
  sendet,
  uebernimmt,
  fehler,
  onSenden,
  onUebernehmen,
  onSchliessen,
}: {
  eintraege: ChatEintrag[];
  felder: readonly KvFeld[];
  firma: string | null;
  jetzt: Date;
  sendet: boolean;
  /** `nachrichtId` der Karte, die gerade übernommen wird. */
  uebernimmt: string | null;
  fehler: string | null;
  /** true, wenn der Text angekommen ist (Feld leeren). */
  onSenden: (text: string) => Promise<boolean>;
  onUebernehmen: (e: ChatEintrag, auswahl: Set<string>) => void;
  onSchliessen: () => void;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const ende = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ende.current?.scrollIntoView?.({ block: "end" });
  }, [eintraege.length, sendet]);

  async function senden() {
    if (!sendbar(text) || sendet) return;
    if (await onSenden(text.trim())) setText("");
  }

  return (
    <aside className="kve-seite kve-chat" data-seite="rechts" aria-label="KI-Chat">
      <div className="kve-seite-kopf">
        <h2>KI-Chat</h2>
        <button type="button" className="kve-zu" aria-label="Chat schließen" onClick={onSchliessen}>
          <SymbolSchliessen />
        </button>
      </div>
      <div className="kve-chat-verlauf" aria-live="polite">
        {eintraege.length === 0 ? (
          <p className="kve-chat-leer">
            Schreib, was im KV anders stehen soll, etwa „Uhrzeit ab 8:30“ oder „beim Sofa: Füße vorher abschrauben“. Die KI schlägt Änderungen vor; erst mit „Übernehmen“ entsteht ein neuer Entwurf. Preise ändert sie nie.
          </p>
        ) : null}
        {eintraege.map((e, i) =>
          e.rolle === "nutzer" ? (
            <div key={`${e.am}-${i}`} className="kve-blase-nutzer">
              <p>{e.text}</p>
              <time dateTime={e.am}>{zeitText(e.am, jetzt)}</time>
            </div>
          ) : (
            <KiBeitrag key={e.nachrichtId ?? `${e.am}-${i}`} e={e} felder={felder} firma={firma} jetzt={jetzt} uebernimmt={uebernimmt === e.nachrichtId} gesperrt={uebernimmt !== null} onUebernehmen={onUebernehmen} />
          )
        )}
        {sendet ? (
          <div className="kve-blase-ki" aria-busy="true">
            <p className="kve-tippt">KI liest den KV …</p>
          </div>
        ) : null}
        <div ref={ende} />
      </div>
      {fehler ? (
        <p className="kve-meldung" data-ton="rose" role="alert">
          {fehler}
        </p>
      ) : null}
      <form
        className="kve-chat-eingabe"
        onSubmit={(ev) => {
          ev.preventDefault();
          void senden();
        }}
      >
        <label htmlFor={`${id}-t`} className="kve-unsichtbar">
          Nachricht an die KI
        </label>
        <textarea
          id={`${id}-t`}
          className="lg-input"
          value={text}
          rows={2}
          maxLength={KV_CHAT_MAX}
          placeholder="Was soll im KV anders stehen?"
          disabled={sendet}
          onChange={(ev) => setText(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" && !ev.shiftKey && !ev.nativeEvent.isComposing) {
              ev.preventDefault();
              void senden();
            }
          }}
        />
        <button type="submit" className="kve-senden" aria-label="Senden" disabled={sendet || !sendbar(text)}>
          <SymbolSenden />
        </button>
      </form>
    </aside>
  );
}

function KiBeitrag({
  e,
  felder,
  firma,
  jetzt,
  uebernimmt,
  gesperrt,
  onUebernehmen,
}: {
  e: ChatEintrag;
  felder: readonly KvFeld[];
  firma: string | null;
  jetzt: Date;
  uebernimmt: boolean;
  gesperrt: boolean;
  onUebernehmen: (e: ChatEintrag, auswahl: Set<string>) => void;
}) {
  const vorschlaege = e.vorschlaege ?? [];
  const [auswahl, setAuswahl] = useState<Set<string>>(() => startAuswahl(vorschlaege));
  const offen = uebernehmbar(e);
  const abgelehnt = ablehnungZeilen(e.abgelehnt ?? []);
  return (
    <div className="kve-blase-ki">
      <p>{e.text}</p>
      {vorschlaege.length > 0 ? (
        <div className="kve-vorschlag" data-status={e.uebernommen ? "uebernommen" : offen ? "offen" : "lesend"}>
          <b className="kve-vorschlag-titel">
            {e.uebernommen ? "Übernommen" : offen ? "Vorschlag" : "Vorschlag (nur Ansicht)"}
          </b>
          <ul>
            {vorschlaege.map((v) => {
              const f = felder.find((x) => x.schluessel === v.schluessel) ?? null;
              const cid = `${e.nachrichtId ?? e.am}-${v.schluessel}`;
              const weg = !!e.uebernommen && !!e.uebernommeneSchluessel && !e.uebernommeneSchluessel.includes(v.schluessel);
              return (
                <li key={v.schluessel} data-weg={weg || undefined}>
                  {offen ? (
                    <input
                      id={cid}
                      type="checkbox"
                      checked={auswahl.has(v.schluessel)}
                      disabled={gesperrt}
                      onChange={(ev) =>
                        setAuswahl((alt) => {
                          const n = new Set(alt);
                          if (ev.target.checked) n.add(v.schluessel);
                          else n.delete(v.schluessel);
                          return n;
                        })
                      }
                    />
                  ) : null}
                  <label htmlFor={offen ? cid : undefined}>
                    <span className="kve-vorschlag-feld">
                      {feldTitel(v)}
                      <span className="kve-klein"> · {KV_ABSCHNITT_TITEL[v.abschnitt]}</span>
                    </span>
                    <span className="kve-vorschlag-wert">
                      <s>{wertText(v.vorher, f?.art ?? null, firma)}</s>
                      <span aria-hidden="true"> → </span>
                      <b>{wertText(v.wert, f?.art ?? null, firma)}</b>
                      {weg ? <span className="kve-klein"> · nicht übernommen</span> : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {offen ? (
            <button type="button" className="kve-knopf" disabled={gesperrt || auswahl.size === 0} onClick={() => onUebernehmen(e, auswahl)}>
              {uebernimmt ? "Übernimmt …" : `Übernehmen (${auswahl.size})`}
            </button>
          ) : null}
        </div>
      ) : null}
      {abgelehnt.length > 0 ? (
        <ul className="kve-abgelehnt" aria-label="Nicht übernommen">
          {abgelehnt.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      ) : null}
      <time dateTime={e.am}>{zeitText(e.am, jetzt)}</time>
    </div>
  );
}

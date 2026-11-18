"use client";

import { useId, useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassDialog, GlassDialogContent, GlassDialogDescription, GlassDialogTitle } from "@/components/glassyui/glass-dialog";
import { tagKurz } from "@/lib/anzeige";
import { KV_EDITOR_TEXT, KV_NUR_ADMIN_TEXT, type KvEditorAnsicht, type KvStandKopf } from "@/lib/kv-editor";
import { feldTitel, pushModus } from "./kv-editor-logik";
import { mergeVollstaendig, wertText, type MergeErgebnis } from "./kv-formular-logik";

// ─── Pushen ──────────────────────────────────────────────────────────────────

/**
 * Inhalt des Push-Dialogs (Spec 7.5, 10): ohne Annahme eine einfache Rückfrage; mit aktiver
 * Annahme „Annahme aufheben?“ mit Haken, nur für Admins; sonst ohne Knopf mit dem Hinweis
 * `KV_NUR_ADMIN_TEXT`. Getrennt vom Dialog, damit er ohne Portal prüfbar ist.
 */
export function PushInhalt({
  stand,
  ansicht,
  laeuft,
  fehler,
  onPushen,
  onAbbrechen,
}: {
  stand: KvStandKopf;
  ansicht: Pick<KvEditorAnsicht, "annahme">;
  laeuft: boolean;
  fehler: string | null;
  onPushen: (annahmeAufhebenBestaetigt: boolean) => void;
  onAbbrechen: () => void;
}) {
  const id = useId();
  const [haken, setHaken] = useState(false);
  const modus = pushModus(ansicht);
  const a = ansicht.annahme;
  return (
    <>
      <p className="akte-dialog-text">
        Stand {stand.nummer} wird der aktuelle KV: Portal, Statuslink, Akte und Dokumentliste zeigen dann ihn. Eine Nachricht an den Kunden geht dabei nicht raus; danach kannst du sie im Chat
        senden.
      </p>
      {modus !== "einfach" ? (
        <div className="kve-rueckfrage" role="alert">
          <b>Annahme aufheben?</b>
          <span>
            Der Kunde hat {a.standNummer !== null ? `Stand ${a.standNummer}` : "den KV"}
            {a.am ? ` am ${tagKurz(a.am)}` : ""} schon angenommen. Pushen hebt diese Annahme auf; der Kunde muss den neuen KV neu annehmen. Termin und Reservierung bleiben. AB und
            Rechnung ändern sich nicht von selbst, bitte bei Bedarf neu erstellen.
          </span>
          {modus === "annahme_admin" ? (
            <label htmlFor={id} className="kve-haken">
              <input id={id} type="checkbox" checked={haken} disabled={laeuft} onChange={(e) => setHaken(e.target.checked)} />
              Annahme aufheben, der Kunde nimmt neu an
            </label>
          ) : (
            <span className="kve-nur-admin">{KV_NUR_ADMIN_TEXT}</span>
          )}
        </div>
      ) : null}
      {fehler ? <p className="akte-dialog-fehler">{fehler}</p> : null}
      <div className="akte-dialog-knoepfe">
        <GlassButton type="button" variant="ghost" disabled={laeuft} onClick={onAbbrechen}>
          {modus === "annahme_gesperrt" ? "Schließen" : "Abbrechen"}
        </GlassButton>
        {modus !== "annahme_gesperrt" ? (
          <GlassButton type="button" disabled={laeuft || (modus === "annahme_admin" && !haken)} onClick={() => onPushen(modus === "annahme_admin" && haken)}>
            {laeuft ? "Pusht …" : modus === "annahme_admin" ? "Annahme aufheben und pushen" : "Pushen"}
          </GlassButton>
        ) : null}
      </div>
    </>
  );
}

export function PushDialog(props: Parameters<typeof PushInhalt>[0] & { portalZiel: HTMLElement | undefined }) {
  const { portalZiel, ...rest } = props;
  return (
    <GlassDialog open onOpenChange={(o) => !o && !props.laeuft && props.onAbbrechen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen" className="kve-dialog">
        <GlassDialogTitle className="akte-dialog-titel">Stand {props.stand.nummer} pushen</GlassDialogTitle>
        <GlassDialogDescription className="kve-unsichtbar">Stand zum aktuellen KV machen</GlassDialogDescription>
        <PushInhalt {...rest} />
      </GlassDialogContent>
    </GlassDialog>
  );
}

// ─── Zusammenführen (409 STAND_VERALTET) ─────────────────────────────────────

/**
 * Inhalt des Zusammenführen-Dialogs (Spec 10, Grok 9): Felder, die nur du geändert hast, gehen
 * mit; beide gleich zählt einmal; beide verschieden: je Feld „deins“ oder „Stand N“ wählen,
 * keine Automatik. Gespeichert wird auf den neuesten Stand als Vorgänger.
 */
export function ZusammenfuehrenInhalt({
  ergebnis,
  neuester,
  firma,
  laeuft,
  fehler,
  onSpeichern,
  onAbbrechen,
}: {
  ergebnis: MergeErgebnis;
  neuester: KvStandKopf;
  firma: string | null;
  laeuft: boolean;
  fehler: string | null;
  onSpeichern: (wahl: Record<string, "meins" | "deren">) => void;
  onAbbrechen: () => void;
}) {
  const id = useId();
  const [wahl, setWahl] = useState<Record<string, "meins" | "deren">>({});
  const fertig = mergeVollstaendig(ergebnis, wahl);
  const n = ergebnis.meineUebernommen.length;
  const von = neuester.erstelltVon?.name;
  return (
    <>
      <p className="akte-dialog-text">
        {KV_EDITOR_TEXT.STAND_VERALTET} Stand {neuester.nummer}
        {von ? ` von ${von}` : ""}. Deine Änderungen kommen auf diesen Stand.
      </p>
      <p className="kve-klein">
        {n === 0 ? "Keine deiner Änderungen geht ohne Wahl mit." : n === 1 ? "1 Änderung von dir geht ohne Rückfrage mit." : `${n} Änderungen von dir gehen ohne Rückfrage mit.`}
        {ergebnis.konflikte.length > 0 ? " Bei diesen Feldern habt ihr beide etwas anderes eingetragen:" : ""}
      </p>
      {ergebnis.konflikte.length > 0 ? (
        <ul className="kve-merge">
          {ergebnis.konflikte.map((k) => (
            <li key={k.schluessel}>
              <b>{feldTitel(k.feld)}</b>
              <div className="kve-wahl kve-wahl-spalten" role="radiogroup" aria-label={feldTitel(k.feld)}>
                <label>
                  <input type="radio" name={`${id}-${k.schluessel}`} checked={wahl[k.schluessel] === "meins"} disabled={laeuft} onChange={() => setWahl((w) => ({ ...w, [k.schluessel]: "meins" }))} />
                  <span>
                    <span className="kve-klein">Deins</span> {wertText(k.meins, k.feld.art, firma)}
                  </span>
                </label>
                <label>
                  <input type="radio" name={`${id}-${k.schluessel}`} checked={wahl[k.schluessel] === "deren"} disabled={laeuft} onChange={() => setWahl((w) => ({ ...w, [k.schluessel]: "deren" }))} />
                  <span>
                    <span className="kve-klein">Stand {neuester.nummer}</span> {wertText(k.deren, k.feld.art, firma)}
                  </span>
                </label>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {fehler ? <p className="akte-dialog-fehler">{fehler}</p> : null}
      <div className="akte-dialog-knoepfe">
        <GlassButton type="button" variant="ghost" disabled={laeuft} onClick={onAbbrechen}>
          Abbrechen
        </GlassButton>
        <GlassButton type="button" disabled={laeuft || !fertig || (n === 0 && ergebnis.konflikte.every((k) => wahl[k.schluessel] !== "meins"))} onClick={() => onSpeichern(wahl)}>
          {laeuft ? "Speichert …" : "Zusammenführen und speichern"}
        </GlassButton>
      </div>
    </>
  );
}

export function ZusammenfuehrenDialog(props: Parameters<typeof ZusammenfuehrenInhalt>[0] & { portalZiel: HTMLElement | undefined }) {
  const { portalZiel, ...rest } = props;
  return (
    <GlassDialog open onOpenChange={(o) => !o && !props.laeuft && props.onAbbrechen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen" className="kve-dialog">
        <GlassDialogTitle className="akte-dialog-titel">Zusammenführen</GlassDialogTitle>
        <GlassDialogDescription className="kve-unsichtbar">Deine Änderungen auf den neuesten Stand legen</GlassDialogDescription>
        <ZusammenfuehrenInhalt {...rest} />
      </GlassDialogContent>
    </GlassDialog>
  );
}
